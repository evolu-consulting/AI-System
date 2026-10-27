// CR-101 DOC-deals · R10 · HD-14 · Câu 1: nâng giao dịch thành HĐ kinh tế — file ký + số HĐ bắt buộc; GIỮ id/mốc/kho/điểm, chỉ đổi
// `doc_type` + gắn file + số; HĐ khoá ngay (trigger K1 trong CÙNG câu UPDATE). Thứ tự: loại tệp (415) → FileBox → MỘT tx (khoá hàng +
// INSERT files + UPDATE chứng từ + event `promoted`) → không nâng được ⇒ gỡ tệp đã lưu. Không AI đọc lại (giao dịch đã có số liệu).
import { orgForTenant } from "../../kit/application/pack-files.ports";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { promoteVerdict } from "../domain/deal.rules";
import { type ContractFileStore, UploadError } from "./upload-contract.ports";
import { sniffUpload, UPLOAD_MIME } from "./upload-contract.usecase";

export type PromoteRow = {
  /** null ⇒ không có / không thấy / tenant khác. */
  doc_type: string | null;
  superseded: boolean;
  /** Đã nâng (cùng câu) ⇒ số version mới + đã khoá. */
  version: number | null;
  locked: boolean;
};
export type PromoteWrite = {
  id: string;
  fileRowId: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  mime: string;
  size: number;
  number: string;
  userId: string;
};
export type PromoteRepo = { promote(w: PromoteWrite): Promise<PromoteRow> };
export type PromoteUow = PackUow<{ promote: PromoteRepo }>;

export type PromoteInput = { id: string; name: string; bytes: Uint8Array; number: string };
export type PromoteResult =
  | { kind: "ok"; id: string; version: number; locked: boolean; file_id: string }
  | { kind: "not_found" | "not_deal" };

export type PromoteContract = (who: PackWho, i: PromoteInput) => Promise<PromoteResult>;

export function createPromoteContract(d: {
  uow: PromoteUow;
  files: ContractFileStore;
  zipNames: (b: Uint8Array) => string[];
  newId: () => string;
}): PromoteContract {
  return async (who, i) => {
    const type = sniffUpload(i.bytes, d.zipNames, i.name);
    if (!type) throw new UploadError("FILE_TYPE");
    const org = orgForTenant(who.tenantId);
    const up = await d.files.put(org, i.name, i.bytes);
    const fileRowId = d.newId();
    let row: PromoteRow;
    try {
      row = await d.uow.tenant(who, (r) =>
        r.promote.promote({
          id: i.id,
          fileRowId,
          org,
          fileId: up.fileId,
          versionId: up.versionId,
          name: i.name,
          mime: UPLOAD_MIME[type],
          size: i.bytes.byteLength,
          number: i.number,
          userId: who.userId,
        }),
      );
    } catch (e) {
      await d.files.remove(org, up.fileId).catch(() => undefined);
      throw e;
    }
    if (row.version === null) {
      await d.files.remove(org, up.fileId).catch(() => undefined);
      if (row.doc_type === null) return { kind: "not_found" };
      const v = promoteVerdict({ doc_type: row.doc_type, superseded: row.superseded });
      return { kind: v === "ok" ? "not_found" : "not_deal" };
    }
    return { kind: "ok", id: i.id, version: row.version, locked: row.locked, file_id: fileRowId };
  };
}
