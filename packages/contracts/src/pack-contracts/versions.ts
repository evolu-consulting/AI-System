// CR-097 K2 · HD-FR-101 tải bản cập nhật (phiên bản mới) · HD-FR-102 v(n+1) thay v(n) · HD-FR-103 cutover · X5 xoá trong chuỗi ·
// UC-04 so sánh · CR-127 K5 (BR-35/36/36a/36b: mốc mở chuyển sang v(n+1), diff theo điều khoản, changes-since-last). Chuỗi phiên bản ≠ phụ lục (`parent_id`) ≠ gia hạn (HĐ mới).
import { z } from "zod";
import { IsoDateTime, VersionSchema } from "../common";
import { ContractStatusSchema, ExtractStateSchema, IsoDateSchema } from "./fields";

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
  status: z.literal("draft"),
  extract_state: ExtractStateSchema,
  version: VersionSchema,
  version_no: z.number().int().min(2),
  root_id: z.uuid(),
  supersedes_id: z.uuid(),
});
export type UploadVersionResponse = z.infer<typeof UploadVersionResponseSchema>;

/** Một điều khoản của văn bản (BR-36): `before`/`after` chỉ có khi điều đó ĐỔI (rút gọn ≤ 4000 chữ); thêm mới ⇒ before null, bỏ ⇒ after null. */
export const ClauseChangeSchema = z.strictObject({
  ref: z.string().min(1).max(20),
  changed: z.boolean(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type ClauseChangeDto = z.infer<typeof ClauseChangeSchema>;

/** `GET /contracts/:id/versions/diff?a=&b=[&text=1]` — hai bản cùng chuỗi với `:id`; `text=1` ⇒ thêm `clauses` (điều khoản đổi). */
export const VersionDiffQuerySchema = z.strictObject({
  a: z.uuid(),
  b: z.uuid(),
  text: z.enum(["0", "1"]).optional(),
});
export const VersionDiffResponseSchema = z.strictObject({
  a: z.strictObject({ id: z.uuid(), version_no: z.number().int().min(1) }),
  b: z.strictObject({ id: z.uuid(), version_no: z.number().int().min(1) }),
  /** Trường pháp lý (23 khoá `fields`) có giá trị khác nhau; `a`/`b` = `value` của từng bản (vắng ⇒ null). */
  changes: z.array(z.strictObject({ key: z.string(), a: z.unknown(), b: z.unknown() })),
  /** CR-127 K5 · BR-36: chỉ khi `text=1` — điều khoản có nội dung đổi giữa `a` và `b` (before = a, after = b). */
  clauses: z.array(ClauseChangeSchema).optional(),
});
export type VersionDiffResponse = z.infer<typeof VersionDiffResponseSchema>;

/**
 * CR-127 K5 · BR-36a · `GET /contracts/:id/changes-since-last` — "Đã đổi so với lần trước" của thẻ duyệt: lần gửi mới nhất (`round`) so với lần
 * ngay trước (`previous_round`): trường pháp lý đổi, đoạn văn bản đổi theo điều khoản (đổi HOẶC được nhắc trong yêu cầu lần Trả lại trước,
 * `requested`), ý kiến Trả lại. Chưa có hồ sơ lần gửi ⇒ round 0; mới một lần gửi ⇒ previous_round null, mảng rỗng.
 */
export const ChangesSinceLastSchema = z.strictObject({
  round: z.number().int().min(0),
  previous_round: z.number().int().min(1).nullable(),
  fields: z.array(z.strictObject({ key: z.string(), before: z.unknown(), after: z.unknown() })),
  clauses: z.array(ClauseChangeSchema.extend({ requested: z.boolean() })),
  return_note: z.string().nullable(),
});
export type ChangesSinceLast = z.infer<typeof ChangesSinceLastSchema>;
