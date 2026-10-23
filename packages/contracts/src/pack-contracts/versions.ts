// CR-097 K2 · HD-FR-101 tải bản cập nhật (phiên bản mới) · HD-FR-102 v(n+1) thay v(n) · HD-FR-103 cutover · X5 xoá trong chuỗi ·
// UC-04 so sánh. Chuỗi phiên bản ≠ phụ lục (`parent_id`) ≠ gia hạn (HĐ mới).
import { z } from "zod";
import { IsoDateTime, VersionSchema } from "../common";
import { ContractStatusSchema, IsoDateSchema } from "./fields";

export const VERSION_ERRORS = {
  /** Bản đã bị thay bởi phiên bản mới ⇒ chỉ đọc (mọi ghi). */
  CONTRACT_SUPERSEDED: 409,
  /** Chuỗi đã có một bản nháp cập nhật đang mở. */
  VERSION_DRAFT_EXISTS: 409,
  /** Xoá bản đã xác nhận trong chuỗi có nhiều phiên bản (CR-097b). */
  CONTRACT_HAS_VERSIONS: 409,
  /** Phụ lục không có phiên bản (decision 9). */
  VERSION_NOT_ALLOWED: 422,
} as const;
export type VersionErrorCode = keyof typeof VERSION_ERRORS;

/** Trần số phiên bản trả trong chi tiết. */
export const CONTRACT_VERSIONS_MAX = 100;

/** Một phiên bản trong chuỗi (chi tiết HĐ, mục "Phiên bản"). */
export const ContractVersionRefSchema = z.strictObject({
  id: z.uuid(),
  version_no: z.number().int().min(1),
  status: ContractStatusSchema,
  superseded_at: IsoDateTime.nullable(),
  number: z.string().nullable(),
  effective_from: IsoDateSchema.nullable(),
  effective_to: IsoDateSchema.nullable(),
  total_value: z.number().int().nullable(),
});
export type ContractVersionRef = z.infer<typeof ContractVersionRefSchema>;

/** `POST /contracts/:id/versions` (multipart `file`, `title` tuỳ chọn) ⇒ 201. */
export const UploadVersionResponseSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(["extracting", "extract_failed"]),
  version: VersionSchema,
  version_no: z.number().int().min(2),
  root_id: z.uuid(),
  supersedes_id: z.uuid(),
});
export type UploadVersionResponse = z.infer<typeof UploadVersionResponseSchema>;

/** `GET /contracts/:id/versions/diff?a=&b=` — hai bản cùng chuỗi với `:id`. */
export const VersionDiffQuerySchema = z.strictObject({ a: z.uuid(), b: z.uuid() });
export const VersionDiffResponseSchema = z.strictObject({
  a: z.strictObject({ id: z.uuid(), version_no: z.number().int().min(1) }),
  b: z.strictObject({ id: z.uuid(), version_no: z.number().int().min(1) }),
  /** Trường pháp lý (23 khoá `fields`) có giá trị khác nhau; `a`/`b` = `value` của từng bản (vắng ⇒ null). */
  changes: z.array(z.strictObject({ key: z.string(), a: z.unknown(), b: z.unknown() })),
});
export type VersionDiffResponse = z.infer<typeof VersionDiffResponseSchema>;
