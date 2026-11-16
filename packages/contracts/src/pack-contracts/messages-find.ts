// CR-178 · «Tin nhắn» — tìm tin (M3) và «Ảnh & tệp» của một cuộc (M4): contract zod cho `GET /messages/search`, `GET /messages/{conversations|partner}/:id/attachments`.
// Không import I/O: chạy được ở trình duyệt. Hành vi: docs/specs/cr178-api/tasks.md (Delta).
import { z } from "zod";
import { ConvKindSchema, FileRefSchema, MsgCompanySchema } from "./messages";

// ---------- Ảnh & tệp (M4) ----------
/** `image` = mime `image/*` (ảnh raster nhận được: png/jpg/gif/webp); còn lại là `file`. MỘT quy ước ở server (lọc SQL) và client (nhãn). */
export const MsgAttachKindSchema = z.enum(["image", "file"]);
export type MsgAttachKind = z.infer<typeof MsgAttachKindSchema>;
export const attachKindOf = (mime: string): MsgAttachKind =>
  mime.startsWith("image/") ? "image" : "file";

export const MSG_ATTACH_PAGE_MAX = 30;
export const MsgAttachmentsQuerySchema = z.object({
  kind: MsgAttachKindSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MSG_ATTACH_PAGE_MAX).default(MSG_ATTACH_PAGE_MAX),
});
export type MsgAttachmentsQuery = z.infer<typeof MsgAttachmentsQuerySchema>;

/** Một tệp đã gửi (đã gắn tin, chưa thu hồi). `seq` = tin chứa tệp (nút «Đến tin nhắn»). */
export const MsgAttachmentSchema = z.object({
  file: FileRefSchema,
  kind: MsgAttachKindSchema,
  sender_id: z.uuid(),
  sender_name: z.string(),
  seq: z.number().int().min(1),
  at: z.iso.datetime(),
});
export type MsgAttachment = z.infer<typeof MsgAttachmentSchema>;
export const MsgAttachmentPageSchema = z.object({
  items: z.array(MsgAttachmentSchema),
  next_cursor: z.string().max(200).nullable(),
});
export type MsgAttachmentPage = z.infer<typeof MsgAttachmentPageSchema>;

// ---------- Tìm tin (M3) ----------
export const MSG_SEARCH_Q_MIN = 2;
export const MSG_SEARCH_Q_MAX = 100;
export const MSG_SEARCH_PAGE_MAX = 20;
export const MSG_SNIPPET_MAX = 160;
export const MsgSearchQuerySchema = z.object({
  /** Không phân biệt hoa/dấu (so khớp `hub.fold` hai phía), khớp chứa chuỗi. */
  q: z.string().trim().min(MSG_SEARCH_Q_MIN).max(MSG_SEARCH_Q_MAX),
  /** Có ⇒ chỉ tìm trong cuộc đó (nút ↑↓); không thấy cuộc ⇒ kết quả rỗng (không lộ cuộc có tồn tại). */
  conversation_id: z.uuid().optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(MSG_SEARCH_PAGE_MAX).default(MSG_SEARCH_PAGE_MAX),
});
export type MsgSearchQuery = z.infer<typeof MsgSearchQuerySchema>;

export const MsgSearchHitSchema = z.object({
  conversation_id: z.uuid(),
  kind: ConvKindSchema,
  /** Tên hiển thị của cuộc: nhóm = tên nhóm; 1-1 và `partner` = tên người kia. */
  title: z.string(),
  /** Chỉ `partner`. */
  company: MsgCompanySchema.nullable(),
  seq: z.number().int().min(1),
  sender_id: z.uuid(),
  sender_name: z.string(),
  at: z.iso.datetime(),
  /** ≤ `MSG_SNIPPET_MAX` ký tự Unicode quanh chỗ khớp (một dòng; «…» ở đầu/cuối khi bị cắt), không cắt đôi cặp thay thế (emoji). */
  snippet: z.string().max(MSG_SNIPPET_MAX * 2),
  /** Vị trí chỗ khớp trong `snippet` (chỉ số UTF-16, [start, end)) để tô sáng; không xác định được ⇒ null. */
  match: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).nullable(),
});
export type MsgSearchHit = z.infer<typeof MsgSearchHitSchema>;
export const MsgSearchPageSchema = z.object({
  items: z.array(MsgSearchHitSchema),
  next_cursor: z.string().max(300).nullable(),
});
export type MsgSearchPage = z.infer<typeof MsgSearchPageSchema>;
