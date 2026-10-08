// HUB-FR-96 · HUB-BR-22 · kiểu Drizzle cho phòng chat X2a (plan-db X2a §4.1). CHỈ để truy vấn có kiểu: DDL thật, CHECK,
// FK kép tenant, EXCLUDE 1 owner, RLS và hàm SECURITY DEFINER ở `migrations-hub/0011_x2a_rooms.sql` + siết ở `0012_x2a_rooms_rls_tighten.sql`, `0013_x2a_rooms_seq_integrity.sql`, X2b `0014_x2b_room_agents.sql` (viết tay).
// Tạo phòng KHÔNG insert trực tiếp `rooms` (không GRANT/policy INSERT): gọi `hub.create_room` (D3).
import { bigint, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const ROOM_KIND_VALUES = ["dm", "group"] as const;
export const ROOM_MEMBER_ROLE_VALUES = ["owner", "member"] as const;
export const ROOM_SENDER_TYPE_VALUES = ["user", "agent"] as const;
export const ROOM_PLACEMENT_VALUES = ["main", "flow"] as const;
export const ROOM_MESSAGE_RUN_STATUS_VALUES = ["finished", "failed", "cancelled"] as const;
export const ROOM_WAIT_KIND_VALUES = ["need_input", "side_effect"] as const;

export const rooms = hub.table("rooms", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind", { enum: ROOM_KIND_VALUES }).notNull(),
  name: text("name"),
  dmKey: text("dm_key"),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  lastActivityAt: ts("last_activity_at").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull(),
  deletedAt: ts("deleted_at"),
});

export const roomMembers = hub.table(
  "room_members",
  {
    roomId: uuid("room_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role", { enum: ROOM_MEMBER_ROLE_VALUES }).notNull().default("member"),
    joinedAt: ts("joined_at").notNull(),
    leftAt: ts("left_at"),
    hiddenAt: ts("hidden_at"),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
);

export const roomMessages = hub.table("room_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  senderType: text("sender_type", { enum: ROOM_SENDER_TYPE_VALUES }).notNull(),
  senderId: uuid("sender_id"),
  content: text("content").notNull(),
  clientMsgId: uuid("client_msg_id"),
  // 0014 (X2b): FK runs / flows (thread) / room_messages (tin gọi). Tin user chỉ được mang `flowId` (thread).
  runId: uuid("run_id"),
  flowId: uuid("flow_id"),
  triggerMessageId: uuid("trigger_message_id"),
  createdAt: ts("created_at").notNull(),
  // 0014 (X2b D12): tin gốc thread / timeline = main; tin trong thread = flow. Meta run chỉ ở tin agent.
  placement: text("placement", { enum: ROOM_PLACEMENT_VALUES }).notNull().default("main"),
  runStatus: text("run_status", { enum: ROOM_MESSAGE_RUN_STATUS_VALUES }),
  waitKind: text("wait_kind", { enum: ROOM_WAIT_KIND_VALUES }),
  ask: jsonb("ask").$type<{ question: string; choices?: string[] }>(),
  stepCount: integer("step_count"),
  runMs: integer("run_ms"),
});
