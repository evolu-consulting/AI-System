// CR-181 · s10 · HĐ vào DONE (ký đủ) ⇒ tự lập + lưu PDF «Hồ sơ duyệt» (FileBox + `contracts.files`, tham chiếu bằng sự kiện `approval_record_saved` —
// không cột mới). Mọi đường vào DONE chạy CHUNG hook đăng ký (`registerContractDoneHook`) TRONG tx của cổng ⇒ hook chỉ `pg_notify` (giao khi COMMIT, không
// chờ/poll); bộ nghe LISTEN lập PDF NGOÀI tx. Nhiều instance cùng nghe: tx lưu khoá advisory theo HĐ + «chưa có bản lưu» ⇒ chỉ một bản được ghi, bản dư xoá ở FileBox.
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackWho } from "../kit/public";
import { createPackUow } from "../kit/public";
import { RECORD_SAVED_EVENT } from "./adapters/approval-record-signs.repo";
import { registerContractDoneHook } from "./adapters/contract-state.repo";
import { packAssignees } from "./adapters/manage.members";
import type { EngineCard } from "./application/approval-engine-card.usecase";
import type { ContractDoneHook } from "./application/contract-done.ports";
import type { ESignFiles } from "./application/esign.ports";
import type { ContractsAiDeps } from "./extraction.types";

export const RECORD_SAVE_CHANNEL = "contract_record_save";

/** Hook DONE: báo «HĐ đã ký đủ» (NOTIFY trong tx ⇒ chỉ giao khi COMMIT). Người lập = người tạo HĐ (chỉ để chạy truy vấn gói; bản lưu đủ nội dung). */
export const recordSaveDoneHook: ContractDoneHook = {
  async onDone(txx, tid, contractId) {
    await (txx as Tx).execute(sql`select pg_notify(${RECORD_SAVE_CHANNEL},
      (select json_build_object('t', c.tenant_id, 'c', c.id, 'u', c.created_by)::text
        from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid))
      where exists (select 1 from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid)`);
  },
};

type SaveRow = {
  id: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  size: number;
  by: string;
};
function saveRepo(tx: Tx, t: string) {
  return {
    /** Ghi tệp + sự kiện nếu CHƯA có bản lưu (khoá advisory theo HĐ). false ⇒ đã có (người gọi xoá tệp vừa đưa lên). */
    async insert(contractId: string, r: SaveRow): Promise<boolean> {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`record-save:${contractId}`}, 0))`,
      );
      const rows = await tx.execute<{ id: string }>(sql`with f as (
          insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
          select ${r.id}::uuid, ${t}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, 'application/pdf', ${r.size}, ${r.by}::uuid
          where not exists (select 1 from contracts.contract_events e where e.tenant_id = ${t}::uuid
            and e.contract_id = ${contractId}::uuid and e.type = ${RECORD_SAVED_EVENT})
          returning id)
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${t}::uuid, ${contractId}::uuid, ${RECORD_SAVED_EVENT}, ${r.by}::uuid,
          jsonb_build_object('file_id', f.id) from f returning id`);
      return rows.length === 1;
    },
  };
}

export type RecordArchive = (
  who: PackWho,
  id: string,
) => Promise<{ name: string; bytes: Uint8Array } | null>;

/** Lập + lưu cho MỘT HĐ (idempotent). true ⇒ đã ghi bản lưu mới. Test gọi thẳng; bộ nghe gọi qua `mountRecordAutoSave`. */
export function saveApprovalRecord(db: Db, files: ESignFiles, archive: RecordArchive) {
  const uow = createPackUow(db, "contracts", (tx: Tx, t: string) => ({ save: saveRepo(tx, t) }));
  return async (tenantId: string, contractId: string, userId: string): Promise<boolean> => {
    const who: PackWho = { tenantId, userId };
    const rec = await archive(who, contractId);
    if (!rec) return false;
    const org = `t_${tenantId}`;
    const put = await files(org).postFile(rec.name, rec.bytes);
    const ok = await uow
      .tenant(who, (r) =>
        r.save.insert(contractId, {
          id: Bun.randomUUIDv7(),
          org,
          fileId: put.fileId,
          versionId: put.versionId,
          name: rec.name,
          size: rec.bytes.byteLength,
          by: userId,
        }),
      )
      .catch(async (e: unknown) => {
        await files(org)
          .deleteFile(put.fileId)
          .catch(() => undefined);
        throw e;
      });
    if (!ok)
      await files(org)
        .deleteFile(put.fileId)
        .catch(() => undefined);
    return ok;
  };
}

/** Đăng ký hook DONE + nghe NOTIFY. Trả hàm gỡ nghe (test). */
export async function mountRecordAutoSave(
  db: Db,
  files: ESignFiles,
  archive: RecordArchive,
): Promise<() => Promise<void>> {
  const save = saveApprovalRecord(db, files, archive);
  return db.listen(RECORD_SAVE_CHANNEL, (payload) => {
    const p = JSON.parse(payload) as { t?: string; c?: string; u?: string | null };
    if (!p.t || !p.c || !p.u) return;
    save(p.t, p.c, p.u).catch((e: unknown) =>
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
