// HUB-FR-96…100 · phòng chat DM/nhóm: thực thể + request/query (X2a plan §2.3). Mọi object strict; không I/O.
import { z } from "zod";
import { CountSchema, DISPLAY_NAME_MAX, IsoDateTime, UuidSchema } from "../common";
import { ChatAgentKeySchema } from "./agents";
import {
  CHAT_ASK_CHOICE_MAX,
  CHAT_ASK_CHOICES_MAX,
  CHAT_ASK_QUESTION_MAX,
  CHAT_CONTENT_MAX,
  ChatCursorSchema,
} from "./entities";

export const ROOM_NAME_MAX = 80;
/** Gồm chủ phòng. */
export const ROOM_MEMBERS_MAX = 50;
/** Giới hạn mảng id ở request (D8). */
export const ROOM_IDS_MAX = 200;
export const ROOM_PREVIEW_MAX = 120;
export const ROOM_KINDS = ["dm", "group"] as const;
export const ROOM_ROLES = ["owner", "member"] as const;
export const ROOM_SENDER_TYPES = ["user", "agent"] as const;
export const ROOM_MESSAGES_LIMIT_DEFAULT = 50;
// HUB-FR-101, 103 · X2b plan §2.2: agent trong phòng (chỉ thêm).
export const ROOM_ORCHESTRATOR_TAG = "orchestrator";
export const ROOM_CONTEXT_MAX = 20;
export const ROOM_THREAD_CONTEXT_MAX = 50;
export const ROOM_ACTIVE_RUNS_MAX = 50;
export const ROOM_PLACEMENTS = ["main", "flow"] as const;
export const ROOM_RUN_STATUSES = ["finished", "failed", "cancelled"] as const;
export const ROOM_WAIT_KINDS = ["need_input", "side_effect"] as const;
/** CR-050 · số comment gần nhất của thread gắn trên khối agent. */
export const ROOM_FLOW_RECENT_MAX = 3;
const ROOM_LIMIT_MAX = 200;
const ROOM_LIST_LIMIT_DEFAULT = 50;

export const SeqSchema = z.number().int().min(0);
const NameSchema = z.string().min(1).max(ROOM_NAME_MAX);
const NameInputSchema = z.string().trim().min(1).max(ROOM_NAME_MAX);
const DisplayNameSchema = z.string().min(1).max(DISPLAY_NAME_MAX);
const KindSchema = z.enum(ROOM_KINDS);
const RoleSchema = z.enum(ROOM_ROLES);
const SenderTypeSchema = z.enum(ROOM_SENDER_TYPES);
const SenderSchema = z.strictObject({ id: UuidSchema, display_name: DisplayNameSchema });

export const RoomUserRefSchema = z.strictObject({
  id: UuidSchema,
  display_name: DisplayNameSchema,
  username: z.string().min(1),
});
export type RoomUserRef = z.infer<typeof RoomUserRefSchema>;

export const RoomLastMessageSchema = z.strictObject({
  seq: z.number().int().min(1),
  sender_type: SenderTypeSchema,
  sender: SenderSchema,
  preview: z.string().max(ROOM_PREVIEW_MAX),
  created_at: IsoDateTime,
});
export type RoomLastMessage = z.infer<typeof RoomLastMessageSchema>;

export const RoomSummarySchema = z.strictObject({
  id: UuidSchema,
  kind: KindSchema,
  name: NameSchema.nullable(),
  peer: RoomUserRefSchema.nullable(),
  member_count: z.number().int().min(1).max(ROOM_MEMBERS_MAX),
  my_role: RoleSchema.nullable(),
  last_message: RoomLastMessageSchema.nullable(),
  last_seq: SeqSchema,
  unread: CountSchema,
  last_activity_at: IsoDateTime,
});
export type RoomSummary = z.infer<typeof RoomSummarySchema>;

export const RoomMemberSchema = z.strictObject({
  id: UuidSchema,
  display_name: DisplayNameSchema,
  username: z.string().min(1),
  role: RoleSchema,
  last_read_seq: SeqSchema,
  joined_at: IsoDateTime,
});
export type RoomMember = z.infer<typeof RoomMemberSchema>;

const AgentNameSchema = z.string().min(1).max(100);
export const RoomAgentRefSchema = z.strictObject({
  key: ChatAgentKeySchema,
  name: z.strictObject({ vi: AgentNameSchema, en: AgentNameSchema }),
});
export type RoomAgentRef = z.infer<typeof RoomAgentRefSchema>;

/** `question/choices` của `side_effect` chỉ có khi người xem = người gọi (X2b D3). */
export const RoomAskSchema = z.strictObject({
  kind: z.enum(ROOM_WAIT_KINDS),
  question: z.string().min(1).max(CHAT_ASK_QUESTION_MAX).optional(),
  choices: z.array(z.string().min(1).max(CHAT_ASK_CHOICE_MAX)).max(CHAT_ASK_CHOICES_MAX).optional(),
});
export type RoomAsk = z.infer<typeof RoomAskSchema>;

export const RoomActiveRunSchema = z.strictObject({
  run_id: UuidSchema,
  flow_id: UuidSchema,
  trigger_message_id: UuidSchema,
  /** null = Orchestrator. */
  agent: RoomAgentRefSchema.nullable(),
  caller: SenderSchema,
  status: z.enum(["running", "waiting"]),
  wait_kind: z.enum(ROOM_WAIT_KINDS).optional(),
  started_at: IsoDateTime,
});
export type RoomActiveRun = z.infer<typeof RoomActiveRunSchema>;

export const RoomDetailSchema = RoomSummarySchema.extend({
  owner_id: UuidSchema.nullable(),
  created_at: IsoDateTime,
  members: z.array(RoomMemberSchema).min(1).max(ROOM_MEMBERS_MAX),
  active_runs: z.array(RoomActiveRunSchema).max(ROOM_ACTIVE_RUNS_MAX).optional(),
});
export type RoomDetail = z.infer<typeof RoomDetailSchema>;

/** CR-050 · một comment gần nhất của thread; `unread` theo người xem (mốc `room_flow_reads`, tin của mình luôn false). */
export const RoomFlowRecentSchema = z.strictObject({
  id: UuidSchema,
  seq: z.number().int().min(1),
  sender_type: SenderTypeSchema,
  sender: SenderSchema,
  /** Tin agent: tên theo ngôn ngữ (vắng = Orchestrator). */
  agent: RoomAgentRefSchema.optional(),
  preview: z.string().max(ROOM_PREVIEW_MAX),
  created_at: IsoDateTime,
  unread: z.boolean(),
});
export type RoomFlowRecent = z.infer<typeof RoomFlowRecentSchema>;

/** `run_id`/`flow_id`/`trigger_message_id`: chỗ cho agent trong phòng; X2a không gửi. */
export const RoomMessageSchema = z.strictObject({
  id: UuidSchema,
  room_id: UuidSchema,
  seq: z.number().int().min(1),
  sender_type: SenderTypeSchema,
  sender: SenderSchema,
  content: z.string().min(1).max(CHAT_CONTENT_MAX),
  client_msg_id: UuidSchema.nullable(),
  created_at: IsoDateTime,
  run_id: UuidSchema.optional(),
  flow_id: UuidSchema.optional(),
  trigger_message_id: UuidSchema.optional(),
  // X2b (vắng ≡ mặc định; không superRefine — tin agent thiếu trường phụ vẫn hợp lệ).
  placement: z.enum(ROOM_PLACEMENTS).optional(),
  agent: RoomAgentRefSchema.optional(),
  caller: SenderSchema.optional(),
  run_status: z.enum(ROOM_RUN_STATUSES).optional(),
  ask: RoomAskSchema.optional(),
  steps: z.strictObject({ count: z.number().int().min(0), ms: z.number().min(0) }).optional(),
  flow: z
    .strictObject({
      message_count: z.number().int().min(0),
      last_active_at: IsoDateTime,
      // CR-050 (chỉ thêm): ≤ 3 tin `flow` mới nhất (seq tăng) + số tin người xem chưa xem trong thread.
      recent: z.array(RoomFlowRecentSchema).max(ROOM_FLOW_RECENT_MAX).optional(),
      unread: CountSchema.optional(),
    })
    .optional(),
});
export type RoomMessage = z.infer<typeof RoomMessageSchema>;

/** Trùng/chính mình trong `member_ids` được bỏ qua ở server. */
export const CreateRoomRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dm"), user_id: UuidSchema }),
  z.strictObject({
    kind: z.literal("group"),
    name: NameInputSchema,
    member_ids: z.array(UuidSchema).max(ROOM_IDS_MAX).default([]),
  }),
]);
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const RenameRoomRequestSchema = z.strictObject({ name: NameInputSchema });
export type RenameRoomRequest = z.infer<typeof RenameRoomRequestSchema>;

export const AddRoomMembersRequestSchema = z.strictObject({
  user_ids: z.array(UuidSchema).min(1).max(ROOM_IDS_MAX),
});
export type AddRoomMembersRequest = z.infer<typeof AddRoomMembersRequestSchema>;

export const TransferRoomRequestSchema = z.strictObject({ user_id: UuidSchema });
export type TransferRoomRequest = z.infer<typeof TransferRoomRequestSchema>;

export const RoomListQuerySchema = z.strictObject({
  cursor: ChatCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(ROOM_LIMIT_MAX).default(ROOM_LIST_LIMIT_DEFAULT),
});
export type RoomListQuery = z.infer<typeof RoomListQuerySchema>;

export const RoomListResponseSchema = z.strictObject({
  items: z.array(RoomSummarySchema),
  next_cursor: z.string().nullable(),
  unread_total: CountSchema,
});
export type RoomListResponse = z.infer<typeof RoomListResponseSchema>;

export const RoomMessageListQuerySchema = z.strictObject({
  flow_id: UuidSchema.optional(),
  before_seq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(ROOM_LIMIT_MAX).default(ROOM_MESSAGES_LIMIT_DEFAULT),
});
export type RoomMessageListQuery = z.infer<typeof RoomMessageListQuerySchema>;

/** `items` theo seq tăng. */
export const RoomMessagePageSchema = z.strictObject({
  items: z.array(RoomMessageSchema).max(ROOM_LIMIT_MAX),
  has_more: z.boolean(),
});
export type RoomMessagePage = z.infer<typeof RoomMessagePageSchema>;

export const SendRoomMessageRequestSchema = z
  .strictObject({
    content: z.string().trim().min(1).max(CHAT_CONTENT_MAX),
    client_msg_id: UuidSchema,
    flow_id: UuidSchema.optional(),
    answer_run_id: UuidSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.answer_run_id !== undefined && v.flow_id === undefined) {
      ctx.addIssue({ code: "custom", path: ["flow_id"], message: "flow_id required" });
    }
  });
export type SendRoomMessageRequest = z.infer<typeof SendRoomMessageRequestSchema>;

export const MarkRoomReadRequestSchema = z.strictObject({ seq: SeqSchema });
export type MarkRoomReadRequest = z.infer<typeof MarkRoomReadRequestSchema>;

export const MarkRoomReadResponseSchema = z.strictObject({
  unread: CountSchema,
  unread_total: CountSchema,
});
export type MarkRoomReadResponse = z.infer<typeof MarkRoomReadResponseSchema>;

/** CR-050 · `POST /rooms/:id/flows/:flow_id/read`: mốc đọc thread chỉ tăng, kẹp ≤ seq lớn nhất của thread. */
export const MarkRoomFlowReadRequestSchema = z.strictObject({ seq: SeqSchema });
export type MarkRoomFlowReadRequest = z.infer<typeof MarkRoomFlowReadRequestSchema>;

export const MarkRoomFlowReadResponseSchema = z.strictObject({ unread: CountSchema });
export type MarkRoomFlowReadResponse = z.infer<typeof MarkRoomFlowReadResponseSchema>;
