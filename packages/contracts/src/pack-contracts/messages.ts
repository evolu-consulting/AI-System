// CR-132 · HD-MSG-01..12 · Tin nhắn giữa nhân viên trong Sổ Hợp Tác (1-1 + nhóm, cùng công ty, realtime). Contract zod cho
// `/pack/contracts/messages/**` + sự kiện `/me/stream` (`msg.*`). Không import I/O: chạy được ở trình duyệt. Spec: docs/specs/CR-132/spec.md §4–5.
import { z } from "zod";
import { AttachMimeSchema } from "../attach";

/** Nhóm tối đa 50 người (cả chủ). */
export const MSG_GROUP_MAX = 50;
export const MSG_TITLE_MAX = 80;
export const MSG_BODY_MAX = 4000;
export const MSG_FILES_MAX = 10;
export const MSG_PREVIEW_MAX = 120;
/** Trần số chưa đọc mỗi hội thoại hiển thị (99 = «99+») và tổng (999). */
export const MSG_UNREAD_CONV_MAX = 99;
export const MSG_UNREAD_TOTAL_MAX = 999;
export const MSG_CONV_PAGE_DEFAULT = 30;
export const MSG_CONV_PAGE_MAX = 50;
export const MSG_PAGE_DEFAULT = 50;
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
  MSG_FILE_TOO_LARGE: 413,
  MSG_FILE_TYPE: 415,
} as const;
export type MsgErrorCode = keyof typeof MSG_ERRORS;

export const ConvKindSchema = z.enum(["direct", "group"]);
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

export const MsgConversationsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MSG_CONV_PAGE_MAX).default(MSG_CONV_PAGE_DEFAULT),
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
]);
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const RenameConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(MSG_TITLE_MAX),
});
export const AddMembersRequestSchema = z.object({ user_ids: UniqueIds(20) });
export type AddMembersRequest = z.infer<typeof AddMembersRequestSchema>;

export const MsgListQuerySchema = z.object({
  before_seq: z.coerce.number().int().min(1).optional(),
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

export const MessagePageSchema = z.object({ items: z.array(MessageSchema), has_more: z.boolean() });
export type MessagePage = z.infer<typeof MessagePageSchema>;

export const PeerSchema = z.object({ id: z.uuid(), name: z.string(), active: z.boolean() });
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
  /** 0..99 (99 hiển thị «99+»). */
  unread: z.number().int().min(0).max(MSG_UNREAD_CONV_MAX),
  last_at: z.iso.datetime(),
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
]);
export type MeStreamMsgEvent = z.infer<typeof MeStreamMsgEventSchema>;
