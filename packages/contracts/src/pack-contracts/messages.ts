// CR-132 · HD-MSG-01..12 · Tin nhắn giữa nhân viên trong Sổ Hợp Tác (1-1 + nhóm, cùng công ty, realtime). Contract zod cho
// `/pack/contracts/messages/**` + sự kiện `/me/stream` (`msg.*`). Không import I/O: chạy được ở trình duyệt. Spec: docs/specs/CR-132/spec.md §4–5.
import { z } from "zod";
import { AttachMimeSchema } from "../attach";
import { CcLinkEventDataSchema } from "./company-connect";

/** Nhóm tối đa 50 người (cả chủ). */
export const MSG_GROUP_MAX = 50;
export const MSG_TITLE_MAX = 80;
export const MSG_BODY_MAX = 4000;
export const MSG_FILES_MAX = 10;
export const MSG_PREVIEW_MAX = 120;
/** Trần số chưa đọc HIỂN THỊ mỗi hội thoại (99 ⇒ «99+» khi vượt) và tổng (999). */
export const MSG_UNREAD_CONV_MAX = 99;
/** Giá trị đếm tối đa trên dây mỗi hội thoại: 100 = «có hơn 99» (server đếm `limit 100`, client hiện «99+» khi > 99). MỘT quy ước ở cả hai phía. */
export const MSG_UNREAD_CONV_CAP = MSG_UNREAD_CONV_MAX + 1;
export const MSG_UNREAD_TOTAL_MAX = 999;
export const MSG_CONV_PAGE_DEFAULT = 30;
export const MSG_CONV_PAGE_MAX = 50;
export const MSG_PAGE_DEFAULT = 30;
export const MSG_PAGE_MAX = 100;

/** Mã lỗi riêng → HTTP. Không phải thành viên / không có / tenant khác ⇒ cùng `MSG_NOT_FOUND` (không lộ hội thoại có tồn tại). */
export const MSG_ERRORS = {
  MSG_NOT_FOUND: 404,
  MSG_DM_SELF: 400,
  MSG_EMPTY: 400,
  MSG_NOT_OWNER: 403,
  MSG_NOT_SENDER: 403,
  MSG_USER_INVALID: 422,
  MSG_GROUP_FULL: 422,
  MSG_FILE_INVALID: 422,
  MSG_DIRECT_FIXED: 409,
  MSG_PEER_INACTIVE: 409,
  /** CR-169 · hai công ty chưa/không còn kết nối (gửi, tải tệp, mở cuộc `partner`). */
  MSG_NOT_CONNECTED: 409,
  MSG_FILE_TOO_LARGE: 413,
  MSG_FILE_TYPE: 415,
} as const;
export type MsgErrorCode = keyof typeof MSG_ERRORS;

export const ConvKindSchema = z.enum(["direct", "group", "partner"]);
export type ConvKind = z.infer<typeof ConvKindSchema>;
export const MemberRoleSchema = z.enum(["owner", "member"]);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

// ---------- Vào ----------
const UniqueIds = (max: number) =>
  z
    .array(z.uuid())
    .min(1)
    .max(max)
    .refine((a) => new Set(a).size === a.length, { message: "unique" });

/** Xem trước tin: một dòng (gộp khoảng trắng), tối đa `MSG_PREVIEW_MAX` KÝ TỰ Unicode (không cắt đôi cặp thay thế). Dùng chung server (`messages.view`) và client (cập nhật theo `msg.new`). */
export function messagePreview(body: string): string {
  const one = body.replace(/\s+/g, " ").trim();
  const chars = Array.from(one);
  return chars.length <= MSG_PREVIEW_MAX ? one : chars.slice(0, MSG_PREVIEW_MAX).join("");
}

export const MsgConversationsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MSG_CONV_PAGE_MAX).default(MSG_CONV_PAGE_DEFAULT),
  /** CR-169 · `all` (mặc định) | `own` | uuid công ty kết nối; kiểm dạng bằng `parseCompanyFilter` (hub `partner.rules.ts`). */
  company: z.string().max(40).optional(),
  /** CR-178 · `true` ⇒ chỉ cuộc có tin chưa đọc (lọc ở máy chủ, cả nội bộ lẫn `partner`); `false`/vắng ⇒ tất cả. */
  unread: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type MsgConversationsQuery = z.infer<typeof MsgConversationsQuerySchema>;

/** `member_ids` ≠ chính mình kiểm ở use case (cần danh tính người gọi). */
export const CreateConversationRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), user_id: z.uuid() }),
  z.object({
    kind: z.literal("group"),
    title: z.string().trim().min(1).max(MSG_TITLE_MAX),
    member_ids: UniqueIds(MSG_GROUP_MAX - 1),
  }),
  /** CR-169 · 1-1 với người của công ty đã kết nối (`tenant_id` = công ty kia). */
  z.strictObject({ kind: z.literal("partner"), tenant_id: z.uuid(), user_id: z.uuid() }),
]);
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const RenameConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(MSG_TITLE_MAX),
});
export const AddMembersRequestSchema = z.object({ user_ids: UniqueIds(20) });
export type AddMembersRequest = z.infer<typeof AddMembersRequestSchema>;

export const MsgListQuerySchema = z.object({
  before_seq: z.coerce.number().int().min(1).optional(),
  /** CR-178 · nhảy tới một tin (kết quả tìm / «Đến tin nhắn»): trang gồm tin `around_seq` + tin cũ hơn và khoảng nửa trang tin mới hơn; có thì bỏ qua `before_seq`. */
  around_seq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MSG_PAGE_MAX).default(MSG_PAGE_DEFAULT),
});
export type MsgListQuery = z.infer<typeof MsgListQuerySchema>;

/** `body` rỗng ⇒ phải có tệp (kiểm ở `messageEmpty` ⇒ 400 `MSG_EMPTY`). */
export const SendMessageRequestSchema = z.object({
  client_id: z.uuid(),
  body: z.string().trim().max(MSG_BODY_MAX),
  file_ids: z
    .array(z.uuid())
    .max(MSG_FILES_MAX)
    .refine((a) => new Set(a).size === a.length, { message: "unique" })
    .default([]),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const MarkReadRequestSchema = z.object({ seq: z.number().int().min(0) });

/** CR-190 · ghim / bỏ ghim một hội thoại (theo người gọi). */
export const PinRequestSchema = z.object({ pinned: z.boolean() });
export type PinRequest = z.infer<typeof PinRequestSchema>;
/** CR-190 · «đánh dấu chưa đọc» (`unread: true`) / bỏ đánh dấu (`false`) — cờ riêng, không đổi mốc đã đọc. */
export const MarkUnreadRequestSchema = z.object({ unread: z.boolean() });
export type MarkUnreadRequest = z.infer<typeof MarkUnreadRequestSchema>;

// ---------- Ra ----------
export const FileRefSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  mime: AttachMimeSchema,
  size: z.number().int().min(0),
});
export type FileRef = z.infer<typeof FileRefSchema>;

export const MessageSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().min(1),
  conversation_id: z.uuid(),
  sender_id: z.uuid(),
  client_id: z.uuid(),
  /** Tin đã thu hồi ⇒ `body` rỗng, `files` rỗng, `deleted` true. */
  body: z.string().max(MSG_BODY_MAX),
  files: z.array(FileRefSchema).max(MSG_FILES_MAX),
  at: z.iso.datetime(),
  deleted: z.boolean(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MessagePageSchema = z.object({
  items: z.array(MessageSchema),
  /** Còn tin CŨ hơn trang này. */
  has_more: z.boolean(),
  /** CR-178 · chỉ khi hỏi `around_seq`: còn tin MỚI hơn trang này. */
  has_newer: z.boolean().optional(),
});
export type MessagePage = z.infer<typeof MessagePageSchema>;

/** CR-169 · công ty đang kết nối (chip lọc, đầu kia của cuộc `partner`). */
export const MsgCompanySchema = z.strictObject({ id: z.uuid(), name: z.string().max(200) });
export type MsgCompany = z.infer<typeof MsgCompanySchema>;
export const MSG_COMPANIES_PAGE_DEFAULT = 30;
export const MSG_COMPANIES_PAGE_MAX = 50;
export const MsgCompaniesQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MSG_COMPANIES_PAGE_MAX)
    .default(MSG_COMPANIES_PAGE_DEFAULT),
});
export type MsgCompaniesQuery = z.infer<typeof MsgCompaniesQuerySchema>;
export const MsgCompanyPageSchema = z.strictObject({
  items: z.array(MsgCompanySchema),
  next_cursor: z.string().max(200).nullable(),
});
export type MsgCompanyPage = z.infer<typeof MsgCompanyPageSchema>;

export const PeerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  /** CR-169 · chức vụ (≤ 80); chưa có ⇒ null. */
  job_title: z.string().max(80).nullable(),
});
export const LastMessageSchema = z.object({
  seq: z.number().int().min(1),
  sender_id: z.uuid(),
  sender_name: z.string(),
  preview: z.string().max(MSG_PREVIEW_MAX),
  has_files: z.boolean(),
  deleted: z.boolean(),
  at: z.iso.datetime(),
});

export const ConversationSummarySchema = z.object({
  id: z.uuid(),
  kind: ConvKindSchema,
  title: z.string().nullable(),
  /** Chỉ 1-1: người còn lại. */
  peer: PeerSchema.nullable(),
  member_count: z.number().int().min(1).max(MSG_GROUP_MAX),
  last_message: LastMessageSchema.nullable(),
  /** 0..100: ≤ 99 hiển thị đúng số, 100 hiển thị «99+». */
  unread: z.number().int().min(0).max(MSG_UNREAD_CONV_CAP),
  last_at: z.iso.datetime(),
  /** CR-169 · chỉ `partner`: công ty đầu kia; còn lại null. */
  company: MsgCompanySchema.nullable(),
  /** CR-169 · `partner` ngắt kết nối / người kia hết hợp lệ ⇒ true (tính lúc đọc); `direct`/`group` luôn false. */
  read_only: z.boolean(),
  /** CR-190 · thời điểm người gọi ghim cuộc này; null = không ghim (chỉ của người gọi, người khác không thấy). Máy chủ luôn gửi; vắng = không ghim. */
  pinned_at: z.iso.datetime().nullable().optional(),
  /** CR-190 · người gọi đã «đánh dấu chưa đọc» (cờ riêng, tự xoá khi mở cuộc). Máy chủ luôn gửi; vắng = false. */
  marked_unread: z.boolean().optional(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationMemberSchema = z.object({
  user_id: z.uuid(),
  name: z.string(),
  role: MemberRoleSchema,
  last_read_seq: z.number().int().min(0),
  active: z.boolean(),
});
export type ConversationMember = z.infer<typeof ConversationMemberSchema>;

export const ConversationDetailSchema = ConversationSummarySchema.extend({
  my_role: MemberRoleSchema,
  members: z.array(ConversationMemberSchema).max(MSG_GROUP_MAX),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export const ConversationPageSchema = z.object({
  items: z.array(ConversationSummarySchema),
  next_cursor: z.string().max(200).nullable(),
});
export type ConversationPage = z.infer<typeof ConversationPageSchema>;

/** CR-190 · trạng thái ghim + đánh dấu của người gọi sau khi đổi. */
export const ConvPrefsSchema = z.object({
  pinned_at: z.iso.datetime().nullable(),
  marked_unread: z.boolean(),
});
export type ConvPrefs = z.infer<typeof ConvPrefsSchema>;

/** Tổng chưa đọc của người gọi, kẹp 999. */
export const UnreadResponseSchema = z.object({
  total: z.number().int().min(0).max(MSG_UNREAD_TOTAL_MAX),
});
export const MarkReadResponseSchema = z.object({
  unread_total: z.number().int().min(0).max(MSG_UNREAD_TOTAL_MAX),
});
export type UnreadResponse = z.infer<typeof UnreadResponseSchema>;

// ---------- Sự kiện realtime `/me/stream` (phát sau commit; zod ở biên client) ----------
export const ME_STREAM_MSG_EVENTS = [
  "msg.new",
  "msg.deleted",
  "msg.read",
  "msg.conversation",
  "cc.link",
] as const;
export type MeStreamMsgEventName = (typeof ME_STREAM_MSG_EVENTS)[number];

/** Không kèm `unread_total`: client tự +1; nối lại / `stream.reset` ⇒ gọi lại `GET /messages/unread`. */
export const MsgNewEventDataSchema = z.strictObject({
  conversation_id: z.uuid(),
  message: MessageSchema,
});
export const MsgDeletedEventDataSchema = z.strictObject({
  conversation_id: z.uuid(),
  seq: z.number().int().min(1),
});
export const MsgReadEventDataSchema = z.strictObject({
  conversation_id: z.uuid(),
  user_id: z.uuid(),
  seq: z.number().int().min(0),
});
export const MsgConversationChangeSchema = z.enum(["added", "removed", "updated"]);
export type MsgConversationChange = z.infer<typeof MsgConversationChangeSchema>;
export const MsgConversationEventDataSchema = z.strictObject({
  conversation_id: z.uuid(),
  change: MsgConversationChangeSchema,
});
export type MsgNewEventData = z.infer<typeof MsgNewEventDataSchema>;
export type MsgDeletedEventData = z.infer<typeof MsgDeletedEventDataSchema>;
export type MsgReadEventData = z.infer<typeof MsgReadEventDataSchema>;
export type MsgConversationEventData = z.infer<typeof MsgConversationEventDataSchema>;

export const MeStreamMsgEventSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("msg.new"), data: MsgNewEventDataSchema }),
  z.strictObject({ event: z.literal("msg.deleted"), data: MsgDeletedEventDataSchema }),
  z.strictObject({ event: z.literal("msg.read"), data: MsgReadEventDataSchema }),
  z.strictObject({ event: z.literal("msg.conversation"), data: MsgConversationEventDataSchema }),
  z.strictObject({ event: z.literal("cc.link"), data: CcLinkEventDataSchema }),
]);
export type MeStreamMsgEvent = z.infer<typeof MeStreamMsgEventSchema>;

/** `data` là chuỗi SSE (JSON) hoặc object đã parse; JSON hỏng, event lạ, khoá thừa ⇒ `null` (không ném). Dùng ở người đọc `ustream:<user>` (hub) và client. */
export function parseMeStreamMsgEvent(event: string, data: unknown): MeStreamMsgEvent | null {
  let json: unknown = data;
  if (typeof data === "string") {
    try {
      json = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const r = MeStreamMsgEventSchema.safeParse({ event, data: json });
  return r.success ? r.data : null;
}

// CR-148 · danh bạ «Thành viên» tải dần (thay mảng đầy đủ của CR-132b): 30 dòng/lần, trần 50; `q` lọc tên không dấu.
export const MSG_PEOPLE_PAGE_DEFAULT = 30;
export const MSG_PEOPLE_PAGE_MAX = 50;
/** fix-review-r1 · con trỏ = base64url(JSON[cờ, tên phòng ≤ 64, tên ≤ 64, id]) ≤ ~600 ký tự với tên tiếng Việt dài nhất (3 byte/ký tự); trần 1024. */
export const MSG_PEOPLE_CURSOR_MAX = 1024;
export const MsgPeopleQuerySchema = z.object({
  cursor: z.string().max(MSG_PEOPLE_CURSOR_MAX).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(MSG_PEOPLE_PAGE_MAX).default(MSG_PEOPLE_PAGE_DEFAULT),
  /** CR-169 · cùng kiểu với `MsgConversationsQuery.company`. */
  company: z.string().max(40).optional(),
});
export type MsgPeopleQuery = z.infer<typeof MsgPeopleQuerySchema>;
export const MsgPersonSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Phòng ban (đầu tiên theo khoá); chưa thuộc phòng nào ⇒ null (giao diện hiện «Chưa có phòng»). */
  department: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** CR-169 · chức vụ (≤ 80); người công ty kia chỉ lộ tên, chức vụ, công ty (không email/điện thoại/phòng ban). */
  job_title: z.string().max(80).nullable(),
  company: MsgCompanySchema,
});
export type MsgPerson = z.infer<typeof MsgPersonSchema>;
export const MsgPeoplePageSchema = z.object({
  items: z.array(MsgPersonSchema),
  next_cursor: z.string().max(MSG_PEOPLE_CURSOR_MAX).nullable(),
});
export type MsgPeoplePage = z.infer<typeof MsgPeoplePageSchema>;

// CR-190 · danh bạ nhóm cho trang Tin nhắn `GET /messages/directory`: nhóm theo thứ tự cố định (từng công ty đối tác A→Z, «Nhóm chat», «Nội bộ»), mỗi nhóm có tổng người,
// số chưa đọc và 15 dòng đầu + con trỏ «Xem thêm» RIÊNG nhóm. Dòng = người/nhóm luật HIỆN TẠI cho nhắn (kể cả chưa từng nhắn) ∪ cuộc đã có; sắp xếp: ghim → tin mới nhất → chưa từng nhắn theo tên A→Z.
export const MSG_DIR_PAGE_DEFAULT = 15;
export const MSG_DIR_PAGE_MAX = 50;
export const MSG_DIR_CURSOR_MAX = 600;
/** `partner:<uuid công ty>` | `chat` | `internal`. */
export const MsgDirGroupKeySchema = z
  .string()
  .max(60)
  .regex(/^(chat|internal|partner:[0-9a-fA-F-]{36})$/);
export const MsgDirectoryQuerySchema = z.object({
  /** Vắng ⇒ mọi nhóm, mỗi nhóm `limit` dòng đầu. Có ⇒ chỉ nhóm đó, trang sau `cursor`. */
  group: MsgDirGroupKeySchema.optional(),
  cursor: z.string().max(MSG_DIR_CURSOR_MAX).optional(),
  /** Tìm theo người, chức vụ, tên nhóm chat, tên công ty (không phân biệt hoa/dấu). */
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(MSG_DIR_PAGE_MAX).default(MSG_DIR_PAGE_DEFAULT),
});
export type MsgDirectoryQuery = z.infer<typeof MsgDirectoryQuerySchema>;
export const MsgDirPersonSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  job_title: z.string().max(80).nullable(),
  /** Người còn dùng được; false ⇒ chỉ còn lịch sử (cuộc đã có). */
  active: z.boolean(),
  company: MsgCompanySchema,
});
export type MsgDirPerson = z.infer<typeof MsgDirPersonSchema>;
export const MsgDirRowSchema = z.object({
  /** Ổn định theo người/nhóm: `u:<user id>` (1-1, đối tác) hoặc `c:<id cuộc>` (nhóm chat). */
  key: z.string().max(64),
  /** Cuộc đã có (tin cuối, chưa đọc, ghim, cờ…); chưa từng nhắn ⇒ null (mở cuộc bằng `POST /messages/conversations`). */
  conversation: ConversationSummarySchema.nullable(),
  /** Người của dòng 1-1/đối tác; dòng nhóm chat ⇒ null. */
  person: MsgDirPersonSchema.nullable(),
});
export type MsgDirRow = z.infer<typeof MsgDirRowSchema>;
export const MsgDirGroupSchema = z.object({
  key: MsgDirGroupKeySchema,
  kind: z.enum(["partner", "chat", "internal"]),
  /** Chỉ nhóm `partner`. */
  company: MsgCompanySchema.nullable(),
  /** Tổng người/nhóm trong nhóm (theo `q` nếu có). */
  total: z.number().int().min(0),
  /** Tổng chưa đọc của nhóm = Σ max(chưa đọc thật, cờ ? 1 : 0) mỗi cuộc, kẹp 999. */
  unread: z.number().int().min(0).max(MSG_UNREAD_TOTAL_MAX),
  items: z.array(MsgDirRowSchema),
  next_cursor: z.string().max(MSG_DIR_CURSOR_MAX).nullable(),
});
export type MsgDirGroup = z.infer<typeof MsgDirGroupSchema>;
export const MsgDirectoryResponseSchema = z.object({ groups: z.array(MsgDirGroupSchema) });
export type MsgDirectoryResponse = z.infer<typeof MsgDirectoryResponseSchema>;
