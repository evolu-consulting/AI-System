// CR-101 DOC-deals · R10 · HD-14 · Câu 1: nâng giao dịch thành HĐ kinh tế — file ký + số HĐ bắt buộc; GIỮ id/mốc/kho/điểm, chỉ đổi
// `doc_type` + gắn file + số. Thứ tự: loại tệp (415) → kiểm thấy-được + là giao dịch hiện hành (404/409, chưa chạm FileBox/hạn mức)
// → hạn mức tải lên/ngày (như tải lên; 429/503) → FileBox → MỘT tx (khoá hàng + INSERT files + UPDATE chứng từ + event `promoted`)
// → không nâng được (đua) ⇒ gỡ tệp + hoàn hạn mức. Review cuối đợt: tenant BẬT duyệt ⇒ HĐ `needs_review` + mở lượt duyệt cấp 1 (engine
// nếu công ty có entitlement, máy cũ nếu không — cùng `startApproval` của nhập tay); TẮT ⇒ khoá ngay (K1), `locked_by` = người nâng.
// Không AI đọc lại (giao dịch đã có số liệu).
import { orgForTenant } from "../../kit/application/pack-files.ports";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { promoteVerdict } from "../domain/deal.rules";
import { type ContractFileStore, UploadError } from "./upload-contract.ports";
import { sniffUpload, UPLOAD_MIME } from "./upload-contract.usecase";

export type PromoteRow = {
  /** null ⇒ không có / không thấy / tenant khác. */
  doc_type: string | null;
  superseded: boolean;
  /** Đã nâng (cùng câu) ⇒ số version mới + trạng thái + đã khoá. */
  version: number | null;
  status: string | null;
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
export type PromoteRepo = {
  promote(w: PromoteWrite): Promise<PromoteRow>;
  /** Một câu đọc (RLS): loại + bị thay; không thấy ⇒ null. */
  check(id: string): Promise<{ doc_type: string; superseded: boolean } | null>;
};
export type PromoteUow = PackUow<{ promote: PromoteRepo }>;

export type PromoteInput = {
  id: string;
  name: string;
  bytes: Uint8Array;
  number: string;
  timeZone: string;
};
export type PromoteResult =
  | {
      kind: "ok";
      id: string;
      version: number;
      status: "active" | "needs_review";
      locked: boolean;
      file_id: string;
    }
  | { kind: "not_found" | "not_deal" };

export type PromoteContract = (who: PackWho, i: PromoteInput) => Promise<PromoteResult>;

/** Hạn mức tải lên/ngày: `take` trừ (vượt/lỗi ⇒ `UploadError`), trả hàm hoàn. */
export type PromoteQuota = (who: PackWho, timeZone: string) => Promise<() => Promise<void>>;

type Deps = {
  uow: PromoteUow;
  files: ContractFileStore;
  zipNames: (b: Uint8Array) => string[];
  newId: () => string;
  quota?: PromoteQuota;
  /** Mở lượt duyệt cấp 1 sau commit khi HĐ về `needs_review` (engine/máy). */
  review?: (who: PackWho, id: string) => Promise<unknown>;
};

const verdictOf = (row: { doc_type: string | null; superseded: boolean } | null) => {
  if (!row || row.doc_type === null) return "not_found" as const;
  return promoteVerdict({ doc_type: row.doc_type, superseded: row.superseded }) === "ok"
    ? null
    : ("not_deal" as const);
};

async function write(d: Deps, who: PackWho, i: PromoteInput, mime: string) {
  const org = orgForTenant(who.tenantId);
  const up = await d.files.put(org, i.name, i.bytes);
  const fileRowId = d.newId();
  const drop = () => d.files.remove(org, up.fileId).catch(() => undefined);
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
        mime,
        size: i.bytes.byteLength,
        number: i.number,
        userId: who.userId,
      }),
    );
  } catch (e) {
    await drop();
    throw e;
  }
  if (row.version === null) await drop();
  return { row, fileRowId };
}

export function createPromoteContract(d: Deps): PromoteContract {
  return async (who, i) => {
    const type = sniffUpload(i.bytes, d.zipNames, i.name);
    if (!type) throw new UploadError("FILE_TYPE");
    const pre = verdictOf(await d.uow.tenant(who, (r) => r.promote.check(i.id)));
    if (pre) return { kind: pre };
    const refund = d.quota ? await d.quota(who, i.timeZone) : async () => undefined;
    let out: Awaited<ReturnType<typeof write>>;
    try {
      out = await write(d, who, i, UPLOAD_MIME[type]);
    } catch (e) {
      await refund().catch(() => undefined);
      throw e;
    }
    const { row, fileRowId } = out;
    if (row.version === null) {
      await refund().catch(() => undefined);
      return { kind: verdictOf(row) ?? "not_found" };
    }
    const status = row.status === "needs_review" ? "needs_review" : "active";
    if (status === "needs_review") await d.review?.(who, i.id);
    return {
      kind: "ok",
      id: i.id,
      version: row.version,
      status,
      locked: row.locked,
      file_id: fileRowId,
    };
  };
}
