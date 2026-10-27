// trello-config-ui · contract `/admin/integrations/trello*` (chỉ platform_admin): cấu hình Trello cho "Góp ý".
// API key/token chỉ GHI; response không bao giờ chứa giá trị — chỉ `set` + 4 ký tự cuối (như /admin/secrets).
import { z } from "zod";
import { IsoDateTime } from "./common";

export const TRELLO_SOURCES = ["db", "env", "none"] as const;
export type TrelloSource = (typeof TRELLO_SOURCES)[number];
export const TRELLO_CHECK_ERRORS = [
  "not_configured",
  "unauthorized",
  "not_found",
  "http",
  "network",
] as const;
export type TrelloCheckError = (typeof TRELLO_CHECK_ERRORS)[number];

export const TrelloSecretStateSchema = z.strictObject({
  set: z.boolean(),
  last4: z.string().nullable(),
});

/** `api_key`/`token`/`list_id`/`updated_at` mô tả hàng DB; `env_configured` = env `TRELLO_*` đủ ba biến. */
export const TrelloConfigViewSchema = z.strictObject({
  source: z.enum(TRELLO_SOURCES),
  env_configured: z.boolean(),
  api_key: TrelloSecretStateSchema,
  token: TrelloSecretStateSchema,
  list_id: z.string().nullable(),
  updated_at: IsoDateTime.nullable(),
});
export type TrelloConfigView = z.infer<typeof TrelloConfigViewSchema>;

export const TRELLO_LIST_ID_RE = /^[A-Za-z0-9]{1,64}$/;

/** Key/token Trello chỉ gồm chữ + số — chặn chèn tham số vào header `Authorization: OAuth …`. */
export const TRELLO_SECRET_RE = /^[A-Za-z0-9]+$/;
/** Chuỗi trống (sau trim) = giữ nguyên; còn lại phải khớp `TRELLO_SECRET_RE`. */
const trelloSecret = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === "" || TRELLO_SECRET_RE.test(v), { message: "invalid" });

/** Trống hoặc thiếu `api_key`/`token` = giữ nguyên giá trị đã lưu (lần lưu đầu bắt buộc cả hai). */
export const TrelloConfigSaveRequestSchema = z.strictObject({
  api_key: trelloSecret(256).optional(),
  token: trelloSecret(512).optional(),
  list_id: z.string().trim().regex(TRELLO_LIST_ID_RE),
});
export type TrelloConfigSaveRequest = z.infer<typeof TrelloConfigSaveRequestSchema>;

export const TrelloCheckResponseSchema = z.strictObject({
  ok: z.boolean(),
  source: z.enum(TRELLO_SOURCES),
  list_name: z.string().nullable(),
  error: z.enum(TRELLO_CHECK_ERRORS).nullable(),
});
export type TrelloCheckResponse = z.infer<typeof TrelloCheckResponseSchema>;
