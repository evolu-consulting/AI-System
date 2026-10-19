// HD-FR-08 · D-06 · D-09 · D-17 · plan §4–§5: cổng của use case tải lên hợp đồng. Lớp 2 — chỉ kiểu.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ContractFields } from "../domain/fields.rules";

/** Ngày đếm: tenant theo múi tenant, toàn hệ thống theo UTC (`YYYY-MM-DD`). */
export type UploadDays = { tenant: string; global: string };

/** Bộ đếm nguyên tử (Redis): `take` = INCR cả hai, trả đếm SAU INCR; lỗi hạ tầng ⇒ ném. */
export type UploadCounter = {
  take(tenantId: string, days: UploadDays): Promise<{ tenant: number; global: number }>;
  refund(tenantId: string, days: UploadDays): Promise<void>;
};

/** Kho byte (FileBox, org theo tenant). `remove` không ném khi đã mất. */
export type ContractFileStore = {
  put(org: string, name: string, bytes: Uint8Array): Promise<{ fileId: string; versionId: string }>;
  remove(org: string, fileId: string): Promise<void>;
};

export type NewUploadedContract = {
  id: string;
  fileRowId: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  mime: string;
  size: number;
  kind: "contract" | "appendix";
  parentId: string | null;
  title: string;
  status: UploadStatus;
  error: string | null;
  fields: ContractFields;
  sourceText: string | null;
  userId: string;
  /** M3 · chế độ flow: id lượt duyệt mở CÙNG câu CTE (HĐ `extracting`); null ⇒ không mở. */
  approvalId?: string | null;
};
export type UploadStatus = "extracting" | "extract_failed";

/** Repo trong tx: một câu (CTE files → contracts → events). Cha không hợp lệ ⇒ `UploadError("PARENT_INVALID")`. */
export type UploadContractRepo = {
  insert(row: NewUploadedContract): Promise<{ id: string; status: UploadStatus; version: number }>;
};
export type UploadTxRepos = { upload: UploadContractRepo } & KitTxRepos;
export type UploadUow = PackUow<UploadTxRepos>;

/** HD2 làm thật; HD1 no-op. Gọi SAU commit. */
export type ExtractionStarter = {
  /** `approvalId` = lượt duyệt đã mở trong tx tải lên (chế độ flow) ⇒ chỉ xếp lượt AI đọc. */
  start(who: PackWho, contractId: string, approvalId?: string | null): Promise<void>;
  /** M3 · true ⇒ tải lên mở lượt duyệt trong CÙNG câu ghi (không thêm câu SQL). */
  opensApproval?: boolean;
};

export type UploadErrorCode =
  | "FILE_TOO_LARGE"
  | "FILE_TYPE"
  | "PARENT_INVALID"
  | "UPLOAD_QUOTA"
  | "UPLOAD_QUOTA_UNAVAILABLE"
  | "DOCX_BUSY";

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "UploadError";
  }
}
