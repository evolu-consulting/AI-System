// HUB-FR-112 · HUB-FR-115 · CR-093 · plan-addendum A10/A11 · TECH-DEBT #190 · truy vấn THEO TẬP cho vòng nền (nhắc, hết
// hạn): mỗi lô vài câu SQL cố định, không phụ thuộc số hàng. Scope `system` (một tx mỗi lô, nhiều tenant): mọi join/insert
// khớp `tenant_id` của hàng nguồn (K3 bản lô, A11); khoá `FOR UPDATE SKIP LOCKED` ⇒ nhiều Hub chạy song song không xử lý
// trùng hàng. Chỉ làm việc DB; người gọi phát sự kiện SAU COMMIT.
import type { NoticeKind } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { type BellSource, packBellsOf } from "../domain/notify/pack-bell.rules";
import type { InsertedNotice } from "./inbox.repo";

export type NoticeRow = {
  tenantId: string;
  userId: string;
  processRunId: string;
  taskId: string | null;
  payload: Record<string, unknown>;
};
export type InsertedNoticeRow = InsertedNotice & { tenantId: string; row: NoticeRow };

export const unreadKey = (tenantId: string, userId: string): string => `${tenantId}:${userId}`;

/**
 * MỘT câu cố định cho cả lô: chèn notice (`jsonb_to_recordset` — một tham số JSON, văn bản SQL không đổi theo số hàng nên
 * mỗi kết nối chỉ chuẩn bị một lần) VÀ đếm chưa đọc của các cặp (tenant, user) trong lô. Câu chính của một câu có CTE ghi
 * dữ liệu đọc ảnh TRƯỚC khi chèn ⇒ unread = số chưa đọc trước + số notice vừa chèn cho cặp đó trong lô — bằng đúng số
 * `count(*)` sau khi chèn trong cùng tx (cách cũ). `id`, `createdAt` sinh app-side, một `createdAt` cho cả lô (thứ tự
 * `created_at desc, id desc` như `insertNotices`).
 */
export async function writeNotices(
  tx: Tx,
  kind: NoticeKind,
  rows: readonly NoticeRow[],
): Promise<{ inserted: InsertedNoticeRow[]; unread: Map<string, number> }> {
  if (rows.length === 0) return { inserted: [], unread: new Map() };
  const createdAt = new Date();
  const candidates = rows.map((r) => ({
    id: crypto.randomUUID(),
    userId: r.userId,
    tenantId: r.tenantId,
    createdAt,
    row: r,
  }));
  const json = JSON.stringify(
    candidates.map((n) => ({
      id: n.id,
      tenant_id: n.tenantId,
      user_id: n.userId,
      process_run_id: n.row.processRunId,
      task_id: n.row.taskId,
      payload: n.row.payload,
    })),
  );
  // contract-flow S1b · chuông gói cho run gắn bản ghi gói — CÙNG câu (không thêm round-trip; SQL bỏ run không gắn gói).
  const bells = bellsJson(kind, candidates);
  const res = await noticeStatement(tx, kind, { json, bells }, createdAt.toISOString());
  // T6c · hàng có user ngoài tenant của hàng bị câu bỏ ⇒ chỉ hàng chèn thật mới có unread/sự kiện.
  const ids = new Set(res.ids);
  const inserted = candidates.filter((n) => ids.has(n.id));
  const keys = new Set(inserted.map((n) => unreadKey(n.tenantId, n.userId)));
  const unread = new Map<string, number>();
  for (const r of res.unread) {
    const k = unreadKey(r.tenant_id, r.user_id);
    if (keys.has(k)) unread.set(k, Number(r.n));
  }
  for (const n of inserted) {
    const k = unreadKey(n.tenantId, n.userId);
    unread.set(k, (unread.get(k) ?? 0) + 1);
  }
  return { inserted, unread };
}

const bellsJson = (
  kind: NoticeKind,
  ns: readonly { id: string; userId: string; row: NoticeRow }[],
) =>
  JSON.stringify(
    packBellsOf(
      kind,
      ns.map((n) => ({
        id: n.id,
        userId: n.userId,
        processRunId: n.row.processRunId,
        payload: n.row.payload,
      })),
    ),
  );

/**
 * fix-review · chỉ mục chuông của run GẮN gói vào cổng `notify.enqueue_pack_runs` (lô nhắc/chuyển cấp đa số run thường):
 * tra run theo PK một lần mỗi run khác nhau (≤ số task lô), giữ thứ tự mảng. Rỗng ⇒ `[]` (hàm trả 0 ngay).
 */
const PACK_ONLY = (bells: string) => sql`select coalesce(jsonb_agg(b.e order by b.i), '[]'::jsonb)
  from jsonb_array_elements(${bells}::jsonb) with ordinality as b(e, i)
  where (b.e->>'run_id')::uuid = any(array(select pr.id from hub.process_runs pr
    where pr.id = any(array(select distinct (e->>'run_id')::uuid from jsonb_array_elements(${bells}::jsonb) e))
      and pr.pack_key is not null))`;

type UnreadRow = { tenant_id: string; user_id: string; n: number | string };
type NoticeResult = { ids: string[]; unread: UnreadRow[] };
const parsed = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

/**
 * Câu chèn notice + đếm chưa đọc (văn bản cố định, dùng chung cho `writeNotices` và làm nóng pool); luôn trả ĐÚNG một
 * hàng `{ids, unread}`. T6c (K3 lô): chỉ chèn khi user thuộc tenant của hàng — `exists admin.users` tra PK theo `id`
 * rồi so `tenant_id` (mỗi hàng một lần tra index, không phụ thuộc thống kê). `ids` = notice chèn thật.
 */
async function noticeStatement(
  tx: Tx,
  kind: NoticeKind,
  { json, bells }: { json: string; bells: string },
  createdAt: string,
): Promise<NoticeResult> {
  const rows = await tx.execute<{ ids: string[] | null; unread: UnreadRow[] | string | null }>(sql`
    with x as (
      select * from jsonb_to_recordset(${json}::jsonb)
        as x(id uuid, tenant_id uuid, user_id uuid, process_run_id uuid, task_id uuid, payload jsonb)
    ), ins as (
      insert into hub.process_notices (id, tenant_id, user_id, kind, process_run_id, task_id, payload, created_at)
      select x.id, x.tenant_id, x.user_id, ${kind}, x.process_run_id, x.task_id, x.payload, ${createdAt}::timestamptz
      from x
      where exists (select 1 from admin.users u where u.id = x.user_id and u.tenant_id = x.tenant_id)
      returning id
    )
    select array(select id::text from ins) as ids,
      (select coalesce(jsonb_agg(g), '[]'::jsonb) from (
        select n.tenant_id, n.user_id, count(*)::int as n from hub.process_notices n
        where n.user_id = any(array(select distinct user_id from x))
          and n.tenant_id = any(array(select distinct tenant_id from x)) and n.read_at is null
        group by n.tenant_id, n.user_id) g) as unread,
      notify.enqueue_pack_runs((${PACK_ONLY(bells)})) as bells`);
  const r = rows[0];
  return { ids: r?.ids ?? [], unread: r?.unread ? parsed(r.unread) : [] };
}

/**
 * contract-flow S1b · chuông gói cho notice vừa chèn ở đường một task (`insertNotices`) — người gọi chỉ gọi khi run gắn bản
 * ghi gói (`pack`), MỘT câu cho mọi người nhận. Tenant/nguồn/link do `notify.enqueue_pack_runs` lấy từ hàng run.
 */
export async function enqueuePackBells(
  tx: Tx,
  kind: NoticeKind,
  rows: readonly BellSource[],
): Promise<void> {
  if (rows.length === 0) return;
  const bells = JSON.stringify(packBellsOf(kind, rows));
  await tx.execute(sql`select notify.enqueue_pack_runs(${bells}::jsonb) as n`);
}

/**
 * approval-inbox · bước xong/huỷ ⇒ chuông gói của task đánh dấu đã đọc cho mọi người nhận (`notify.resolve_pack_tasks`,
 * migrations-hub/0061). Người gọi chỉ gọi khi run gắn bản ghi gói.
 */
export async function resolvePackBells(tx: Tx, taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await tx.execute(
    sql`select notify.resolve_pack_tasks(array[${sql.join(
      taskIds.map((i) => sql`${i}`),
      sql`, `,
    )}]::uuid[]) as n`,
  );
}

/** Làm nóng: chạy câu chèn notice với lô rỗng (không ghi hàng nào) trên kết nối của `tx`. */
export async function warmNotices(tx: Tx): Promise<void> {
  await noticeStatement(tx, "reminder", { json: "[]", bells: "[]" }, new Date(0).toISOString());
}
