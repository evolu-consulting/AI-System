// feedback · contract "Góp ý về app" cấp nền tảng: user gửi/xem góp ý của mình (`/auth/feedback*`, mọi web proxy `/auth`),
// admin lọc/đổi trạng thái/trả lời (`/admin/feedback*`, tenant_admin + platform_admin). Không email.
import { z } from "zod";
import { IsoDateTime } from "./common";

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export const FEEDBACK_STATUSES = ["new", "in_progress", "done"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_MESSAGE_MAX = 4000;
export const FEEDBACK_FILES_MAX = 3;
export const FEEDBACK_FILE_BYTES_MAX = 2 * 1024 * 1024;
/** Ảnh chụp màn hình + PDF/văn bản nhỏ; loại khác bị từ chối ở biên. */
export const FEEDBACK_FILE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
] as const;

export const FeedbackKindSchema = z.enum(FEEDBACK_KINDS);
export const FeedbackStatusSchema = z.enum(FEEDBACK_STATUSES);

export const FeedbackFileInSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  mime: z.enum(FEEDBACK_FILE_MIMES),
  /** base64 (không tiền tố data:) của tối đa 2 MB. */
  data_base64: z
    .string()
    .min(1)
    .max(Math.ceil((FEEDBACK_FILE_BYTES_MAX * 4) / 3) + 8),
});

export const FeedbackCreateRequestSchema = z.strictObject({
  kind: FeedbackKindSchema,
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX),
  /** App gửi (khoá catalog: chat | contracts | studio | admin). */
  app: z.string().regex(/^[a-z0-9-]{2,32}$/),
  page_url: z.string().max(500).default(""),
  app_version: z.string().max(64).default(""),
  files: z.array(FeedbackFileInSchema).max(FEEDBACK_FILES_MAX).default([]),
});
export type FeedbackCreateRequest = z.input<typeof FeedbackCreateRequestSchema>;
export type FeedbackCreateParsed = z.output<typeof FeedbackCreateRequestSchema>;

export const FeedbackFileRefSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  mime: z.string(),
  size_bytes: z.number().int().min(0),
});

export const FeedbackItemSchema = z.strictObject({
  id: z.uuid(),
  tenant_id: z.uuid(),
  tenant_name: z.string(),
  user_id: z.uuid(),
  user_name: z.string(),
  app: z.string(),
  kind: FeedbackKindSchema,
  message: z.string(),
  page_url: z.string(),
  app_version: z.string(),
  status: FeedbackStatusSchema,
  reply: z.string().nullable(),
  replied_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  files: z.array(FeedbackFileRefSchema),
});
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;

export const FeedbackListResponseSchema = z.strictObject({
  items: z.array(FeedbackItemSchema),
  total: z.number().int().min(0),
});
export type FeedbackListResponse = z.infer<typeof FeedbackListResponseSchema>;

export const FeedbackListQuerySchema = z.strictObject({
  tenant_id: z.uuid().optional(),
  app: z
    .string()
    .regex(/^[a-z0-9-]{2,32}$/)
    .optional(),
  kind: FeedbackKindSchema.optional(),
  status: FeedbackStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type FeedbackListQuery = z.input<typeof FeedbackListQuerySchema>;

/** Admin: đổi trạng thái và/hoặc trả lời (ít nhất một). */
export const FeedbackUpdateRequestSchema = z
  .strictObject({
    status: FeedbackStatusSchema.optional(),
    reply: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX).optional(),
  })
  .refine((v) => v.status !== undefined || v.reply !== undefined, { message: "empty" });
export type FeedbackUpdateRequest = z.infer<typeof FeedbackUpdateRequestSchema>;
