// CR-161 · kết nối hai công ty không cần hợp đồng: tìm / mời / ngắt, bài Bảng tin công khai của công ty kết nối.
// (CR-169: trò chuyện CR-161 đã gỡ — tin nhắn ở `messages.ts`, `/messages/partner/**`.) Contract zod cho `/pack/contracts/connect/**` + sự kiện `/me/stream` (`cc.*`). Không import I/O: chạy được ở trình duyệt. Spec: docs/specs/CR-161/spec.md §2–3.
import { z } from "zod";

export const CC_NOTE_MAX = 500;
export const CC_SEARCH_MIN = 3;
export const CC_SEARCH_MAX = 120;
export const CC_SEARCH_LIMIT = 20;
export const CC_LIST_DEFAULT = 20;
export const CC_LIST_MAX = 50;
export const CC_CURSOR_MAX = 200;

/** Mã lỗi riêng → HTTP (spec §3). 42501 của hàm đồng ý/từ chối ⇒ 404 như cũ, không nằm ở đây. */
export const CC_ERRORS = {
  CONNECT_NOT_LISTED: 422,
  CONNECT_DECLINED: 409,
  CONNECT_NOT_CONNECTED: 409,
  /** BR-187-5: bật «cho tìm thấy» cần tên pháp lý + MST. */
  CONNECT_NEEDS_PROFILE: 422,
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
export type ConnectInviteBody = z.infer<typeof ConnectInviteBodySchema>;
export type ConnectListQuery = z.infer<typeof ConnectListQuerySchema>;

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
});
export type ConnectLink = z.infer<typeof ConnectLinkSchema>;
export const ConnectListResponseSchema = z.strictObject({
  items: z.array(ConnectLinkSchema),
  next_cursor: z.string().nullable(),
});
export const ConnectInviteResponseSchema = z.strictObject({ status: ConnectStatusSchema });

// ---------- Sự kiện realtime `/me/stream` (nằm trong union `MeStreamMsgEventSchema`, messages.ts) ----------
export const CcLinkEventDataSchema = z.strictObject({
  tenant_id: z.uuid(),
  status: ConnectStatusSchema,
});
export type CcLinkEventData = z.infer<typeof CcLinkEventDataSchema>;

// ---------- CR-191 · cài đặt «Ai được tìm và mời đối tác mới», từ chối kèm lý do, trang công ty ----------
export const CC_REASON_MAX = 300;
export const ConnectInviteBySchema = z.enum(["admin", "all"]);
export type ConnectInviteBy = z.infer<typeof ConnectInviteBySchema>;
/** `PUT /connect/settings` (chỉ người Toàn quyền). */
export const ConnectSettingsBodySchema = z.strictObject({ invite_by: ConnectInviteBySchema });
/** `GET /connect/settings` — `can_invite`: người đang xem có được tìm/mời đối tác mới không (theo cài đặt). */
export const ConnectSettingsSchema = z.strictObject({
  invite_by: ConnectInviteBySchema,
  can_invite: z.boolean(),
});
export type ConnectSettings = z.infer<typeof ConnectSettingsSchema>;
/** `POST /connect/links/:id/decline` — lý do không bắt buộc. */
export const ConnectDeclineBodySchema = z.strictObject({
  reason: z.string().trim().max(CC_REASON_MAX).optional(),
});
/** `GET /connect/companies/:id` — trang công ty: hồ sơ công khai tối thiểu, KHÔNG có bài. */
export const ConnectCompanyPageSchema = z.strictObject({
  tenant_id: z.uuid(),
  legal_name: z.string(),
  tax_code: z.string(),
  verified: z.boolean(),
  address: z.string().nullable(),
  cover: z.string().nullable(),
  status: ConnectStatusSchema,
});
export type ConnectCompanyPage = z.infer<typeof ConnectCompanyPageSchema>;

/** `GET /connect/listing` — công tắc «Cho công ty khác tìm thấy công ty mình» (BR-187-5, quản trị Sổ Hợp Tác). */
export const ConnectListingSchema = z.strictObject({
  listed: z.boolean(),
  has_profile: z.boolean(),
});
export type ConnectListing = z.infer<typeof ConnectListingSchema>;
export const ConnectListingBodySchema = z.strictObject({ listed: z.boolean() });
