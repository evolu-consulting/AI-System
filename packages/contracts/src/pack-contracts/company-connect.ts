// CR-161 · kết nối hai công ty không cần hợp đồng: tìm / mời / ngắt, trò chuyện giữa hai công ty, bài Bảng tin công khai của công ty kết nối.
// Contract zod cho `/pack/contracts/connect/**` + sự kiện `/me/stream` (`cc.*`). Không import I/O: chạy được ở trình duyệt. Spec: docs/specs/CR-161/spec.md §2–3.
import { z } from "zod";

export const CC_BODY_MAX = 4000;
export const CC_FILES_MAX = 10;
export const CC_FILE_MAX_BYTES = 20_971_520;
export const CC_NOTE_MAX = 500;
export const CC_SEARCH_MIN = 3;
export const CC_SEARCH_MAX = 120;
export const CC_SEARCH_LIMIT = 20;
export const CC_LIST_DEFAULT = 20;
export const CC_LIST_MAX = 50;
export const CC_MSG_DEFAULT = 50;
export const CC_MSG_MAX = 100;
export const CC_CURSOR_MAX = 200;

/** Mã lỗi riêng → HTTP (spec §3). 42501 của hàm đồng ý/từ chối ⇒ 404 như cũ, không nằm ở đây. */
export const CC_ERRORS = {
  CONNECT_NOT_LISTED: 422,
  CONNECT_DECLINED: 409,
  CONNECT_NOT_CONNECTED: 409,
  CONNECT_READ_ONLY: 409,
  CONNECT_NO_THREAD: 404,
  MSG_EMPTY: 422,
  MSG_FILE_INVALID: 422,
} as const;
export type CcErrorCode = keyof typeof CC_ERRORS;

export const ConnectStatusSchema = z.enum([
  "connected",
  "pending_out",
  "pending_in",
  "declined",
  "none",
]);
export type ConnectStatus = z.infer<typeof ConnectStatusSchema>;

// ---------- Vào ----------
export const ConnectSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(CC_SEARCH_MIN).max(CC_SEARCH_MAX),
});
export const ConnectInviteBodySchema = z.strictObject({
  tenant_id: z.uuid(),
  note: z.string().trim().max(CC_NOTE_MAX).optional(),
});
export const ConnectListQuerySchema = z.strictObject({
  cursor: z.string().max(CC_CURSOR_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(CC_LIST_MAX).default(CC_LIST_DEFAULT),
  status: z.enum(["connected", "pending_in", "pending_out"]).optional(),
});
export const CcMessagesQuerySchema = z.strictObject({
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(CC_MSG_MAX).default(CC_MSG_DEFAULT),
});
export const CcSendBodySchema = z.strictObject({
  client_id: z.uuid(),
  body: z.string().max(CC_BODY_MAX).default(""),
  file_ids: z.array(z.uuid()).max(CC_FILES_MAX).default([]),
});
export const CcReadBodySchema = z.strictObject({ seq: z.number().int().min(0) });
export const CcPostsQuerySchema = z.strictObject({
  cursor: z.string().max(CC_CURSOR_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(CC_LIST_MAX).default(CC_LIST_DEFAULT),
});
export type ConnectInviteBody = z.infer<typeof ConnectInviteBodySchema>;
export type ConnectListQuery = z.infer<typeof ConnectListQuerySchema>;
export type CcMessagesQuery = z.infer<typeof CcMessagesQuerySchema>;
export type CcSendBody = z.infer<typeof CcSendBodySchema>;

// ---------- Ra ----------
const iso = z.iso.datetime();
export const ConnectCompanySchema = z.strictObject({
  tenant_id: z.uuid(),
  legal_name: z.string(),
  tax_code: z.string(),
  verified: z.boolean(),
  status: ConnectStatusSchema,
});
export type ConnectCompany = z.infer<typeof ConnectCompanySchema>;
export const ConnectSearchResponseSchema = z.strictObject({
  items: z.array(ConnectCompanySchema).max(CC_SEARCH_LIMIT),
});

export const ConnectLinkSchema = ConnectCompanySchema.extend({
  note: z.string().nullable(),
  invited_by_name: z.string().nullable(),
  since: iso,
  unread: z.number().int().min(0),
});
export type ConnectLink = z.infer<typeof ConnectLinkSchema>;
export const ConnectListResponseSchema = z.strictObject({
  items: z.array(ConnectLinkSchema),
  next_cursor: z.string().nullable(),
});
export const ConnectInviteResponseSchema = z.strictObject({ status: ConnectStatusSchema });

export const CcFileSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  mime: z.string(),
  size: z.number().int().min(0).max(CC_FILE_MAX_BYTES),
});
export type CcFile = z.infer<typeof CcFileSchema>;
export const CcFileUploadResponseSchema = z.strictObject({ file: CcFileSchema });
/** `GET /connect/files/:file_id` → link tải ngắn hạn (JSON như tin nhắn SHT; web mở tab mới, không fetch có Authorization sang origin khác). */
export const CcFileLinkResponseSchema = z.strictObject({ url: z.string().min(1) });

export const CcMessageSchema = z.strictObject({
  seq: z.number().int(),
  sender_tenant: z.uuid(),
  sender_name: z.string(),
  sender_company: z.string(),
  body: z.string(),
  files: z.array(CcFileSchema),
  created_at: iso,
  mine: z.boolean(),
});
export type CcMessage = z.infer<typeof CcMessageSchema>;
export const CcMessagesResponseSchema = z.strictObject({
  items: z.array(CcMessageSchema),
  next_before: z.number().int().nullable(),
  read_only: z.boolean(),
  last_read_seq: z.number().int().min(0),
});
export const CcSendResponseSchema = z.strictObject({
  message: CcMessageSchema,
  created: z.boolean(),
});
export const CcReadResponseSchema = z.strictObject({ last_read_seq: z.number().int().min(0) });

export const CcPostSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(["sell", "buy", "note"]),
  title: z.string(),
  body: z.string(),
  fields: z.record(z.string(), z.unknown()),
  cats: z.array(z.string()),
  created_at: iso,
  file_count: z.number().int().min(0),
});
export type CcPost = z.infer<typeof CcPostSchema>;
export const CcPostsResponseSchema = z.strictObject({
  items: z.array(CcPostSchema),
  next_cursor: z.string().nullable(),
});

// ---------- Sự kiện realtime `/me/stream` (nằm trong union `MeStreamMsgEventSchema`, messages.ts) ----------
/** `tenant_id` = công ty kia (so với người nhận). */
export const CcMsgEventDataSchema = z.strictObject({
  tenant_id: z.uuid(),
  seq: z.number().int().min(1),
});
export const CcLinkEventDataSchema = z.strictObject({
  tenant_id: z.uuid(),
  status: ConnectStatusSchema,
});
export type CcMsgEventData = z.infer<typeof CcMsgEventDataSchema>;
export type CcLinkEventData = z.infer<typeof CcLinkEventDataSchema>;
