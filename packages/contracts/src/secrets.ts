// ADM-FR-50, ADM-BR-04, AC-A06 · contract /admin/secrets* (spec M2 §3, M2-R01…R06).
// Không có trường nào chứa giá trị/bản mã trong response: `value` chỉ có ở request.
import { z } from "zod";
import {
  CATALOG_KEY_RE,
  CountSchema,
  IsoDateTime,
  ListQueryBase,
  listResponseSchema,
  QueryBoolSchema,
  SECRET_NAME_RE,
  SECRET_NOTE_MAX,
  SECRET_VALUE_MAX,
  SECRET_VALUE_MIN,
  SecretNameSchema,
  UpdatedBySchema,
  UuidSchema,
} from "./common";

/**
 * Giá trị 8–2048 (đếm UTF-16 như `String.length`), không trim, không chuẩn hoá (M2-R01). Không dùng `.min/.max` của
 * zod 4 vì chúng đếm code point (emoji 2 đơn vị UTF-16 = 1), lệch với spec và với CHECK độ dài bản mã của DB.
 */
export const SecretValueSchema = z.string().superRefine((v, ctx) => {
  if (v.length < SECRET_VALUE_MIN)
    ctx.addIssue({
      code: "too_small",
      origin: "string",
      minimum: SECRET_VALUE_MIN,
      inclusive: true,
      message: "too small",
    });
  if (v.length > SECRET_VALUE_MAX)
    ctx.addIssue({
      code: "too_big",
      origin: "string",
      maximum: SECRET_VALUE_MAX,
      inclusive: true,
      message: "too big",
    });
});
/** Ghi chú trim ≤ 200; `""` → `null`. */
export const SecretNoteSchema = z
  .string()
  .trim()
  .max(SECRET_NOTE_MAX)
  .transform((v) => (v === "" ? null : v));

/** `last4` = 4 code point cuối (DB `char_length = 4`), nên không dùng `.length(4)` (đếm UTF-16). */
const Last4Schema = z.string().refine((v) => Array.from(v).length === 4, {
  message: "last4 must be 4 code points",
});

export const SecretSchema = z.strictObject({
  id: UuidSchema,
  name: z.string().regex(SECRET_NAME_RE),
  last4: Last4Schema,
  note: z.string().min(1).max(SECRET_NOTE_MAX).nullable(),
  /** Key workflow đang tham chiếu, sắp tăng dần. */
  used_by: z.array(z.string().regex(CATALOG_KEY_RE)),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
});
export type Secret = z.infer<typeof SecretSchema>;

export const SecretCreateRequestSchema = z.strictObject({
  name: SecretNameSchema,
  value: SecretValueSchema,
  note: SecretNoteSchema.optional(),
});
export type SecretCreateRequest = z.infer<typeof SecretCreateRequestSchema>;

/** `PUT /admin/secrets/:name`: thay giá trị (IV mới, `last4` mới, giữ `id`). */
export const SecretReplaceRequestSchema = z.strictObject({ value: SecretValueSchema });
export type SecretReplaceRequest = z.infer<typeof SecretReplaceRequestSchema>;

/** `PATCH /admin/secrets/:name`: chỉ ghi chú, không đụng bản mã. */
export const SecretNoteRequestSchema = z.strictObject({ note: SecretNoteSchema.nullable() });
export type SecretNoteRequest = z.infer<typeof SecretNoteRequestSchema>;

/** `q` khớp `name`/`note` (ILIKE); sắp `name`. */
export const SecretListQuerySchema = ListQueryBase.extend({ used: QueryBoolSchema.optional() });
export type SecretListQuery = z.infer<typeof SecretListQuerySchema>;

/** Tính trừ bộ lọc `used` (chip). */
export const SecretListCountsSchema = z.strictObject({
  all: CountSchema,
  used: CountSchema,
  unused: CountSchema,
});
export type SecretListCounts = z.infer<typeof SecretListCountsSchema>;

export const SecretListResponseSchema = listResponseSchema(SecretSchema, SecretListCountsSchema);
export type SecretListResponse = z.infer<typeof SecretListResponseSchema>;
