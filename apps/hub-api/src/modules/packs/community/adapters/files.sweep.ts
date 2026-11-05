// CR-118 · cr118-r2-server · dọn tệp bài Community (`community.files`, byte ở FileBox org `t_<tenant>`). Chạy trong vòng nền
// Community (`startCommunitySweeper`), scope HỆ THỐNG từng tenant bật gói. Luật: tệp KHÔNG nằm trên bài nào (không có
// `community.media` trỏ tới — bài xoá ⇒ media xoá dây chuyền) và (tạo quá 24 h ∨ đã đánh dấu ở lượt trước).
// Mỗi tenant mỗi lượt: (1) tx claim ≤ `limit` hàng `FOR UPDATE SKIP LOCKED` + đánh dấu `deleted_at` (tải/gắn đã lọc
// `deleted_at is null`) — MỘT câu; (2) NGOÀI tx xoá byte (FileBox `DELETE` idempotent, 404 = đã xoá); lỗi ⇒ giữ hàng đã đánh
// dấu, lượt sau làm lại; (3) tx MỘT câu DELETE hàng đã xoá byte (vẫn không media; policy `files_delete` 0007 chỉ cho hệ thống).
// Đồng hồ là tham số (`at`) — test gọi `sweepFilesOnce`, không sleep.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PackSystemUow } from "../../kit/public";
import type { CommunityBlobs } from "../application/pack-ports";

export const FILE_UNATTACHED_TTL_MS = 24 * 3_600_000;
export const FILE_SWEEP_LIMIT = 200;
/** Số lời xoá byte song song tối đa mỗi tenant. */
const DROP_PARALLEL = 8;

export type FileSweepDeps = {
  uow: PackSystemUow<{ tx: Tx }>;
  tenants: () => Promise<readonly string[]>;
  blobs: CommunityBlobs;
  limit?: number;
  warn?: (m: string, meta: Record<string, unknown>) => void;
};
export type FileSweepResult = { tenants: number; swept: number; failed: number };

type Claimed = { id: string; file_id: string };

/** Claim + đánh dấu (MỘT câu). Hàng đã đánh dấu mà còn không media ⇒ claim lại (làm lại sau lỗi kho). */
async function claim(tx: Tx, t: string, now: Date, limit: number): Promise<Claimed[]> {
  const cutoff = new Date(now.getTime() - FILE_UNATTACHED_TTL_MS).toISOString();
  const rows = await tx.execute<Claimed>(sql`with c as (
      select f.id from community.files f
      where f.tenant_id = ${t}::uuid and (f.deleted_at is not null or f.created_at < ${cutoff}::timestamptz)
        and not exists (select 1 from community.media m where m.file_id = f.id and m.tenant_id = f.tenant_id)
      order by f.created_at limit ${limit} for update of f skip locked)
    update community.files f set deleted_at = coalesce(f.deleted_at, ${now.toISOString()}::timestamptz)
    from c where f.id = c.id returning f.id::text as id, f.file_id`);
  return [...rows];
}

/** Xoá hàng đã xoá byte (MỘT câu, mảng id qua một tham số JSON); còn media ⇒ giữ. */
async function deleteRows(tx: Tx, t: string, ids: readonly string[]): Promise<number> {
  const r = await tx.execute(sql`delete from community.files f
    where f.tenant_id = ${t}::uuid and f.deleted_at is not null
      and f.id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid))
      and not exists (select 1 from community.media m where m.file_id = f.id and m.tenant_id = f.tenant_id)`);
  return r.count;
}

/** Xoá byte; trả id hàng đã xoá được + số lỗi (không ném). */
async function dropAll(
  blobs: CommunityBlobs,
  t: string,
  rows: readonly Claimed[],
): Promise<{ gone: string[]; failed: number }> {
  const gone: string[] = [];
  let failed = 0;
  for (let i = 0; i < rows.length; i += DROP_PARALLEL) {
    await Promise.all(
      rows.slice(i, i + DROP_PARALLEL).map(async (f) => {
        try {
          await blobs.drop(t, f.file_id);
          gone.push(f.id);
        } catch {
          failed++;
        }
      }),
    );
  }
  return { gone, failed };
}

export async function sweepFilesTenant(
  d: FileSweepDeps,
  t: string,
  now: Date,
): Promise<{ swept: number; failed: number }> {
  const limit = d.limit ?? FILE_SWEEP_LIMIT;
  const rows = await d.uow.system(t, ({ tx }) => claim(tx, t, now, limit));
  if (rows.length === 0) return { swept: 0, failed: 0 };
  const { gone, failed } = await dropAll(d.blobs, t, rows);
  if (failed > 0) d.warn?.("community-file-drop-failed", { tenant_id: t, failed });
  if (gone.length === 0) return { swept: 0, failed };
  const swept = await d.uow.system(t, ({ tx }) => deleteRows(tx, t, gone));
  return { swept, failed };
}

/** Một lượt cho mọi tenant bật gói (tuần tự; lỗi một tenant không chặn tenant khác). */
export async function sweepFilesOnce(d: FileSweepDeps, at?: Date): Promise<FileSweepResult> {
  const now = at ?? new Date();
  const ts = await d.tenants();
  const sum: FileSweepResult = { tenants: ts.length, swept: 0, failed: 0 };
  for (const t of ts) {
    try {
      const r = await sweepFilesTenant(d, t, now);
      sum.swept += r.swept;
      sum.failed += r.failed;
    } catch (e) {
      d.warn?.("community-file-sweep-tenant-failed", {
        tenant_id: t,
        error: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  return sum;
}
