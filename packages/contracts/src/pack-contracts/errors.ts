// HD-FR-02 · HD-FR-07 · HD-FR-08 · HD-AC06 · D-06 · HD1 plan §1 bảng lỗi: mã lỗi gói hợp đồng = PackErrorCode (N1) + mã riêng.
import { z } from "zod";
import { IsoDateTime } from "../common";
import { PackErrorCode } from "../packs";
import { versionConflictDetailsSchema } from "../version-conflict";

/** Mã riêng HD1 → HTTP. `NOT_FOUND`/`VALIDATION` dùng mã có sẵn. */
export const CONTRACT_ERRORS = {
  CONTRACT_STALE: 409,
  FIELD_UNKNOWN: 422,
  FIELD_INVALID: 422,
  PARENT_INVALID: 422,
  /** HD5: loại hàng trùng tên (không phân biệt hoa/thường). */
  CATEGORY_EXISTS: 409,
  /** HD5: tenant đã có đủ 200 loại hàng. */
  CATEGORY_LIMIT: 422,
  FILE_TOO_LARGE: 413,
  FILE_TYPE: 415,
  UPLOAD_QUOTA: 429,
  UPLOAD_QUOTA_UNAVAILABLE: 503,
  /** FileBox chưa cấu hình ⇒ không tải lên được. */
  FILE_STORAGE_UNAVAILABLE: 503,
  /** HD2: HĐ đang trích ⇒ không trích lại. */
  EXTRACT_BUSY: 409,
  /** HD2: không có văn bản lẫn tệp để trích. */
  NO_SOURCE: 422,
  /** HD2 review Thấp 7: HĐ đã qua kiểm/sửa (duyệt, đang theo dõi…) ⇒ không trích lại. */
  EXTRACT_NOT_ALLOWED: 409,
  /** HD2 D2-01: chưa nối agent trích (N2). */
  AGENT_UNAVAILABLE: 503,
  /** HD4-FR-06: ghi kết quả xử lý cho HĐ chưa duyệt hoặc phụ lục. */
  CONTRACT_NOT_CONFIRMED: 409,
  /** V2-G: dòng SP đã có phát sinh kho (V2-D) ⇒ không đổi SP đã gắn (C12). */
  ITEM_LOCKED: 409,
  /** V2-G: Lưu ở màn xác nhận khi HĐ không còn chờ xác nhận (đã duyệt / đang đọc / bị từ chối). */
  REVIEW_NOT_ALLOWED: 409,
} as const;
type OwnCode = keyof typeof CONTRACT_ERRORS;
const OWN_CODES = Object.keys(CONTRACT_ERRORS) as OwnCode[];

export const ContractErrorCode = z.enum([...PackErrorCode.options, ...OWN_CODES]);
export type ContractErrorCode = z.infer<typeof ContractErrorCode>;

/** 409 `CONTRACT_STALE`: `{current: {version}, updated_at}`. */
export const ContractStaleDetailsSchema = versionConflictDetailsSchema(
  z.object({ version: z.number().int().min(1) }),
);
export type ContractStaleDetails = z.infer<typeof ContractStaleDetailsSchema>;

export const FieldUnknownDetailsSchema = z.strictObject({
  keys: z.array(z.string().max(100)).min(1).max(50),
});
export const FieldInvalidDetailsSchema = z.strictObject({ key: z.string().max(100) });

export const UPLOAD_QUOTA_SCOPES = ["tenant", "global"] as const;
export const UploadQuotaDetailsSchema = z.strictObject({
  scope: z.enum(UPLOAD_QUOTA_SCOPES),
  limit: z.number().int().min(1),
  resets_at: IsoDateTime,
});
export type UploadQuotaDetails = z.infer<typeof UploadQuotaDetailsSchema>;
