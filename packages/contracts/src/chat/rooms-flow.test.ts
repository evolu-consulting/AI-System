// CR-050 · `flow.recent` / `flow.unread` trên tin agent gốc + body đánh dấu đọc thread (chỉ thêm, tin cũ vẫn hợp lệ).
import { describe, expect, test } from "bun:test";
import {
  MarkRoomFlowReadRequestSchema,
  MarkRoomFlowReadResponseSchema,
  RoomMessageSchema,
} from "./rooms";

const U = "11111111-1111-4111-8111-111111111111";
const T = "2026-10-08T12:00:00.000Z";
const base = {
  id: U,
  room_id: U,
  seq: 3,
  sender_type: "agent",
  sender: { id: U, display_name: "Trello" },
  content: "xong",
  client_msg_id: null,
  created_at: T,
  flow_id: U,
};
const recent = (n: number) => ({
  id: U,
  seq: n,
  sender_type: "user",
  sender: { id: U, display_name: "Thomas" },
  preview: "ok",
  created_at: T,
  unread: true,
});

describe("CR-050 · RoomMessage.flow", () => {
  test("flow cũ (không recent/unread) vẫn hợp lệ", () => {
    const flow = { message_count: 2, last_active_at: T };
    expect(RoomMessageSchema.safeParse({ ...base, flow }).success).toBe(true);
  });
  test("recent ≤ 3, unread ≥ 0", () => {
    const flow = { message_count: 5, last_active_at: T, recent: [4, 5, 6].map(recent), unread: 2 };
    expect(RoomMessageSchema.safeParse({ ...base, flow }).success).toBe(true);
    const four = { ...flow, recent: [4, 5, 6, 7].map(recent) };
    expect(RoomMessageSchema.safeParse({ ...base, flow: four }).success).toBe(false);
    expect(RoomMessageSchema.safeParse({ ...base, flow: { ...flow, unread: -1 } }).success).toBe(
      false,
    );
  });
  test("recent strict: khoá lạ bị từ chối", () => {
    const flow = { message_count: 1, last_active_at: T, recent: [{ ...recent(4), x: 1 }] };
    expect(RoomMessageSchema.safeParse({ ...base, flow }).success).toBe(false);
  });
  test("đánh dấu đọc thread: { seq ≥ 0 } → { unread }", () => {
    expect(MarkRoomFlowReadRequestSchema.safeParse({ seq: 7 }).success).toBe(true);
    expect(MarkRoomFlowReadRequestSchema.safeParse({ seq: -1 }).success).toBe(false);
    expect(MarkRoomFlowReadResponseSchema.safeParse({ unread: 0 }).success).toBe(true);
  });
});
