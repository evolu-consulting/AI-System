// HUB-FR-99 · luồng SSE `/me/stream` theo người dùng (X2a plan §2.4, §7). Frame: `id: <redis id>\nevent\ndata\n\n`;
// `stream.reset` không có `id:`; ping dùng `SSE_PING_FRAME` (events.ts).
import { z } from "zod";
import { CountSchema, UuidSchema } from "../common";
import {
  ROOM_RUN_STATUSES,
  ROOM_WAIT_KINDS,
  RoomAgentRefSchema,
  RoomMessageSchema,
  RoomSummarySchema,
} from "./rooms";

export const ME_STREAM_EVENTS = [
  "room.message",
  "room.unread",
  "room.read",
  "room.member_added",
  "room.member_removed",
  "room.updated",
  "room.deleted",
  "stream.reset",
] as const;
export type MeStreamEventName = (typeof ME_STREAM_EVENTS)[number];

/** Id Redis Stream (mờ với client; dùng cho `Last-Event-ID`). */
export const STREAM_EVENT_ID_RE = /^\d{1,20}-\d{1,20}$/;
export const USER_STREAM_MAXLEN = 1000;
export const USER_STREAM_CONN_MAX = 5;

const room_id = UuidSchema;

export const RoomMessageEventDataSchema = z.strictObject({ room_id, message: RoomMessageSchema });
export const RoomUnreadEventDataSchema = z.strictObject({
  room_id,
  unread: CountSchema,
  total: CountSchema,
});
export const RoomReadEventDataSchema = z.strictObject({
  room_id,
  user_id: UuidSchema,
  seq: z.number().int().min(0),
});
export const RoomMemberAddedEventDataSchema = z.strictObject({
  room_id,
  user_id: UuidSchema,
  room: RoomSummarySchema.optional(),
});
export const RoomMemberRemovedEventDataSchema = z.strictObject({ room_id, user_id: UuidSchema });
export const RoomUpdatedEventDataSchema = z.strictObject({
  room_id,
  name: z.string().min(1).optional(),
  owner_id: UuidSchema.optional(),
});
export const RoomDeletedEventDataSchema = z.strictObject({ room_id });
export const StreamResetEventDataSchema = z.strictObject({});

export type RoomMessageEventData = z.infer<typeof RoomMessageEventDataSchema>;
export type RoomUnreadEventData = z.infer<typeof RoomUnreadEventDataSchema>;
export type RoomReadEventData = z.infer<typeof RoomReadEventDataSchema>;
export type RoomMemberAddedEventData = z.infer<typeof RoomMemberAddedEventDataSchema>;
export type RoomMemberRemovedEventData = z.infer<typeof RoomMemberRemovedEventDataSchema>;
export type RoomUpdatedEventData = z.infer<typeof RoomUpdatedEventDataSchema>;
export type RoomDeletedEventData = z.infer<typeof RoomDeletedEventDataSchema>;
export type StreamResetEventData = z.infer<typeof StreamResetEventDataSchema>;

export const MeStreamEventSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("room.message"), data: RoomMessageEventDataSchema }),
  z.strictObject({ event: z.literal("room.unread"), data: RoomUnreadEventDataSchema }),
  z.strictObject({ event: z.literal("room.read"), data: RoomReadEventDataSchema }),
  z.strictObject({ event: z.literal("room.member_added"), data: RoomMemberAddedEventDataSchema }),
  z.strictObject({
    event: z.literal("room.member_removed"),
    data: RoomMemberRemovedEventDataSchema,
  }),
  z.strictObject({ event: z.literal("room.updated"), data: RoomUpdatedEventDataSchema }),
  z.strictObject({ event: z.literal("room.deleted"), data: RoomDeletedEventDataSchema }),
  z.strictObject({ event: z.literal("stream.reset"), data: StreamResetEventDataSchema }),
]);
export type MeStreamEvent = z.infer<typeof MeStreamEventSchema>;

/** Khung SSE (`event`, `data` thô) thành sự kiện; JSON hỏng, event lạ hoặc khoá thừa trả `null` (không ném). */
export function parseMeStreamEvent(event: string, data: string): MeStreamEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const r = MeStreamEventSchema.safeParse({ event, data: json });
  return r.success ? r.data : null;
}

// HUB-FR-101, 103 · sự kiện run trong phòng (X2b plan §2.3, D10): hằng riêng, không đổi `ME_STREAM_EVENTS`.
export const ME_STREAM_RUN_EVENTS = [
  "room.run_started",
  "room.run_waiting",
  "room.run_finished",
] as const;
export type MeStreamRunEventName = (typeof ME_STREAM_RUN_EVENTS)[number];

export const RoomRunStartedEventDataSchema = z.strictObject({
  room_id,
  run_id: UuidSchema,
  flow_id: UuidSchema,
  trigger_message_id: UuidSchema,
  agent: RoomAgentRefSchema.nullable(),
  caller: z.strictObject({ id: UuidSchema, display_name: z.string().min(1) }),
});
export const RoomRunWaitingEventDataSchema = z.strictObject({
  room_id,
  run_id: UuidSchema,
  flow_id: UuidSchema,
  caller_id: UuidSchema,
  kind: z.enum(ROOM_WAIT_KINDS),
});
export const RoomRunFinishedEventDataSchema = z.strictObject({
  room_id,
  run_id: UuidSchema,
  flow_id: UuidSchema,
  status: z.enum(ROOM_RUN_STATUSES),
  message_id: UuidSchema.nullable(),
});
export type RoomRunStartedEventData = z.infer<typeof RoomRunStartedEventDataSchema>;
export type RoomRunWaitingEventData = z.infer<typeof RoomRunWaitingEventDataSchema>;
export type RoomRunFinishedEventData = z.infer<typeof RoomRunFinishedEventDataSchema>;

export const MeStreamRunEventSchema = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("room.run_started"), data: RoomRunStartedEventDataSchema }),
  z.strictObject({ event: z.literal("room.run_waiting"), data: RoomRunWaitingEventDataSchema }),
  z.strictObject({ event: z.literal("room.run_finished"), data: RoomRunFinishedEventDataSchema }),
]);
export type MeStreamRunEvent = z.infer<typeof MeStreamRunEventSchema>;

/** Như `parseMeStreamEvent`: JSON hỏng, event lạ hoặc khoá thừa trả `null` (không ném). */
export function parseMeStreamRunEvent(event: string, data: string): MeStreamRunEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const r = MeStreamRunEventSchema.safeParse({ event, data: json });
  return r.success ? r.data : null;
}
