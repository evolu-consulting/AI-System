// CR-181 · s10 · HĐ vào DONE (ký đủ) ⇒ tự lập + lưu PDF «Hồ sơ duyệt» (FileBox + `contracts.files`, tham chiếu bằng sự kiện `approval_record_saved` —
// không cột mới). Mọi đường vào DONE chạy CHUNG hook đăng ký (`registerContractDoneHook`) TRONG tx của cổng ⇒ hook chỉ `pg_notify` (giao khi COMMIT, không
// chờ/poll); bộ nghe LISTEN lập PDF NGOÀI tx. Nhiều instance cùng nghe: tx lưu khoá advisory theo HĐ + «chưa có bản lưu» ⇒ chỉ một bản được ghi, bản dư xoá ở FileBox.
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackWho } from "../kit/public";
import { createPackUow } from "../kit/public";
import { RECORD_SAVED_EVENT, versionsKeySql } from "./adapters/approval-record-signs.repo";
import { registerContractDoneHook } from "./adapters/contract-state.repo";
import { packAssignees } from "./adapters/manage.members";
import type { EngineCard, SavePdf } from "./application/approval-engine-card.usecase";
import type { ContractDoneHook } from "./application/contract-done.ports";
import type { ESignFiles } from "./application/esign.ports";
import type { ContractsAiDeps } from "./extraction.types";

export const RECORD_SAVE_CHANNEL = "contract_record_save";

/** Hook DONE: báo «HĐ đã ký đủ» (NOTIFY trong tx ⇒ chỉ giao khi COMMIT) — đường nhanh; mất NOTIFY thì «lập khi cần» ở route/khối hồ sơ bù lại. */
export const recordSaveDoneHook: ContractDoneHook = {
  async onDone(txx, tid, contractId) {
    await (txx as Tx).execute(sql`select pg_notify(${RECORD_SAVE_CHANNEL},
      (select json_build_object('t', c.tenant_id, 'c', c.id, 'u', coalesce(c.created_by, ${SYSTEM_USER}::uuid))::text
        from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid))
      where exists (select 1 from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid)`);
  },
};
/** Người lập khi HĐ không có `created_by`: bản lưu đủ nội dung (`full`) nên không phụ thuộc quyền của một người. */
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

type SaveRow = {
  id: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  size: number;
  by: string;
};
const lockKey = (contractId: string) => `record-save:${contractId}`;
function saveRepo(tx: Tx, t: string) {
  return {
    /** Khoá advisory theo HĐ (hết tx tự nhả): false ⇒ nơi khác đang lập ⇒ bỏ qua, không lập trùng. */
    async tryLock(contractId: string): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${lockKey(contractId)}, 0)) as ok`,
      );
      return r?.ok === true;
    },
    /** Đã có bản lưu khớp tập bản ký cuối hiện hành? */
    async hasValid(contractId: string): Promise<boolean> {
      const [r] = await tx.execute<{
        n: number;
      }>(sql`select count(*)::int as n from contracts.contract_events e
        where e.tenant_id = ${t}::uuid and e.contract_id = ${contractId}::uuid and e.type = ${RECORD_SAVED_EVENT}
          and e.data ->> 'versions' = ${versionsKeySql(t, contractId)}`);
      return (r?.n ?? 0) > 0;
    },
    async insert(contractId: string, r: SaveRow): Promise<void> {
      await tx.execute(sql`with f as (
          insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
          values (${r.id}::uuid, ${t}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, 'application/pdf', ${r.size}, ${r.by}::uuid)
          returning id)
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${t}::uuid, ${contractId}::uuid, ${RECORD_SAVED_EVENT}, ${r.by}::uuid,
          jsonb_build_object('file_id', f.id, 'versions', ${versionsKeySql(t, contractId)}) from f`);
    },
  };
}

export type RecordArchive = (
  who: PackWho,
  id: string,
) => Promise<{ name: string; bytes: Uint8Array } | null>;

/**
 * Lập + lưu PDF hồ sơ cho MỘT HĐ. Một tx: `pg_try_advisory_xact_lock` TRƯỚC khi lập (không lập trùng) → đã có bản hợp lệ thì thôi → `build` → FileBox →
 * ghi `contracts.files` + sự kiện (khoá = tập bản ký cuối). Lỗi sau khi đưa tệp lên ⇒ xoá tệp, ném lại (tx hoàn tác; lần xem sau thử lại).
 * Trả bản vừa lưu; null ⇒ không lưu mới (đang có nơi khác lập / đã có / không có gì để lưu).
 */
export function saveApprovalRecord(db: Db, files: ESignFiles): SavePdf {
  const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({ save: saveRepo(tx, t) }));
  return (who, contractId, build) =>
    uow.tenant(who, async (r) => {
      if (!(await r.save.tryLock(contractId)) || (await r.save.hasValid(contractId))) return null;
      const rec = await build();
      if (!rec) return null;
      const org = `t_${who.tenantId}`;
      const put = await files(org).postFile(rec.name, rec.bytes);
      try {
        await r.save.insert(contractId, {
          id: Bun.randomUUIDv7(),
          org,
          fileId: put.fileId,
          versionId: put.versionId,
          name: rec.name,
          size: rec.bytes.byteLength,
          by: who.userId,
        });
      } catch (e) {
        await files(org)
          .deleteFile(put.fileId)
          .catch(() => undefined);
        throw e;
      }
      return rec;
    });
}

/** Đăng ký hook DONE + nghe NOTIFY. Trả hàm gỡ nghe (test). */
export async function mountRecordAutoSave(
  db: Db,
  files: ESignFiles,
  archive: RecordArchive,
): Promise<() => Promise<void>> {
  const save = saveApprovalRecord(db, files);
  return db.listen(RECORD_SAVE_CHANNEL, (payload) => {
    const p = JSON.parse(payload) as { t?: string; c?: string; u?: string | null };
    if (!p.t || !p.c || !p.u) return;
    const who: PackWho = { tenantId: p.t, userId: p.u };
    const contractId = p.c;
    const build = async () => {
      const rec = await archive(who, contractId);
      if (!rec) logger.warn("approval-record-archive-empty", { contract_id: contractId });
      return rec;
    };
    save(who, contractId, build).catch((e: unknown) =>
      logger.warn("approval-record-save-failed", {
        contract_id: p.c,
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
  });
}

/** CR-181 · s10 · cổng hub/FileBox cho hồ sơ duyệt: ảnh chữ ký đã in, đọc bản lưu, tên người ký (người không có bước duyệt). */
export function recordDeps(d: ContractsAiDeps, db: Db, view: PackAccessView) {
  return {
    evidenceBytes: d.evidenceBytes,
    evidenceNames: d.evidenceNames,
    ...(d.recordFiles ? { savePdf: saveApprovalRecord(db, d.recordFiles) } : {}),
    ...(d.stampPng ? { stampPng: d.stampPng } : {}),
    ...(d.recordFiles
      ? {
          savedBytes: (org: string, fileId: string) =>
            (d.recordFiles as ESignFiles)(org).getContent(fileId),
        }
      : {}),
    userNames: async (w: PackWho, ids: readonly string[]) => {
      const want = new Set(ids);
      return new Map(
        (await packAssignees(db, view, "contracts").list(w))
          .filter((m) => want.has(m.id))
          .map((m) => [m.id, m.name] as const),
      );
    },
  };
}

/** CR-181 · s10 · HĐ ký đủ ⇒ bộ nghe lập + lưu PDF hồ sơ (cần FileBox). */
export function startRecordSave(db: Db, d: ContractsAiDeps, archive: RecordArchive) {
  if (!d.recordFiles) return;
  registerContractDoneHook(recordSaveDoneHook, "hồ-sơ-duyệt"); // HĐ vào DONE ⇒ NOTIFY (chỉ khi có FileBox để lưu)
  void mountRecordAutoSave(db, d.recordFiles, archive).catch((e: unknown) =>
    logger.warn("approval-record-listen-failed", {
      error: e instanceof Error ? e.name : "unknown",
    }),
  );
}

type Who = { userId: string; tenantId: string };
/** Route hồ sơ duyệt của thẻ duyệt (vắng thẻ ⇒ null ⇒ 404). */
export const cardRoutes = (card: EngineCard | undefined) => ({
  record: async (w: Who, i: string) => (await card?.record(w, i)) ?? null,
  evidenceFile: async (w: Who, i: string, e: string, f: string) =>
    (await card?.evidenceFile(w, i, e, f)) ?? null,
  recordPdf: async (w: Who, i: string) => (await card?.recordPdf(w, i)) ?? null,
  stampFile: async (w: Who, i: string, s: string) => (await card?.stampFile(w, i, s)) ?? null,
});
