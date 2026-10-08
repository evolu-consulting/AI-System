// X2a · vá cache thuần (plan-frontend §3).
import { describe, expect, test } from "bun:test";
import type { RoomMessage, RoomSummary } from "@ai/contracts/chat";
import {
  applySentMessage,
  insertMessage,
  moveRoomToTop,
  patchMemberRead,
  patchRoomInList,
  patchUnreadTotal,
  type RoomListData,
  type RoomMessagesData,
  removeRoomFromList,
  roomKeys,
  unreadTotalOf,
} from "./room-cache";

const AT = "2026-10-07T00:00:00.000Z";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const room = (n: number, unread = 0): RoomSummary => ({
  id: uid(n),
  kind: "group",
  name: `R${n}`,
  peer: null,
  member_count: 2,
  my_role: "member",
  last_message: null,
  last_seq: 0,
  unread,
  last_activity_at: AT,
});
const list = (...rs: RoomSummary[]): RoomListData => ({
  pages: [{ items: rs, next_cursor: null, unread_total: 3 }],
  pageParams: [undefined],
});
const msg = (n: number, seq: number): RoomMessage => ({
  id: uid(100 + n),
  room_id: uid(1),
  seq,
  sender_type: "user",
  sender: { id: uid(9), display_name: "A" },
  content: "hi",
  client_msg_id: null,
  created_at: AT,
});

describe("room-cache", () => {
  test("keys", () => {
    expect(roomKeys.list).toEqual(["rooms", "list"]);
    expect(roomKeys.messages("x")).toEqual(["rooms", "messages", "x"]);
  });
  test("patch / unread_total / remove", () => {
    const d = list(room(1, 2), room(2));
    expect(patchRoomInList(d, uid(1), { unread: 0 })?.pages[0]?.items[0]?.unread).toBe(0);
    expect(unreadTotalOf(patchUnreadTotal(d, 7))).toBe(7);
    expect(removeRoomFromList(d, uid(1))?.pages[0]?.items.map((r) => r.id)).toEqual([uid(2)]);
    expect(patchRoomInList(undefined, uid(1), {})).toBeUndefined();
    expect(unreadTotalOf(undefined)).toBe(0);
  });
  test("moveRoomToTop đưa lên đầu, chèn nếu chưa có", () => {
    const d = list(room(1), room(2));
    expect(moveRoomToTop(d, room(2))?.pages[0]?.items.map((r) => r.id)).toEqual([uid(2), uid(1)]);
    expect(moveRoomToTop(d, room(3))?.pages[0]?.items).toHaveLength(3);
  });
  test("insertMessage khử trùng id, giữ thứ tự seq", () => {
    const d: RoomMessagesData = {
      pages: [{ items: [msg(1, 1), msg(3, 3)], has_more: false }],
      pageParams: [undefined],
    };
    expect(insertMessage(d, msg(2, 2))?.pages[0]?.items.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(insertMessage(d, msg(1, 1))).toBe(d);
  });
  test("patchMemberRead lấy max", () => {
    const detail = {
      ...room(1),
      owner_id: uid(9),
      created_at: AT,
      members: [
        {
          id: uid(9),
          display_name: "A",
          username: "a",
          role: "owner" as const,
          last_read_seq: 5,
          joined_at: AT,
        },
      ],
    };
    expect(patchMemberRead(detail, uid(9), 3)?.members[0]?.last_read_seq).toBe(5);
    expect(patchMemberRead(detail, uid(9), 8)?.members[0]?.last_read_seq).toBe(8);
  });
});

describe("applySentMessage (RV1 #10)", () => {
  test("tin của mình: unread phòng = 0, unread_total trừ phần cũ, phòng lên đầu", () => {
    const d = list(room(1), room(2, 2)); // unread_total = 3
    const out = applySentMessage(d, uid(2), { ...msg(1, 5), room_id: uid(2) });
    expect(out?.pages[0]?.items.map((r) => r.id)).toEqual([uid(2), uid(1)]);
    expect(out?.pages[0]?.items[0]?.unread).toBe(0);
    expect(unreadTotalOf(out)).toBe(1);
  });
  test("không âm; phòng lạ giữ nguyên; preview gộp khoảng trắng", () => {
    const d = list(room(1, 9));
    const out = applySentMessage(d, uid(1), { ...msg(1, 2), content: "a\n  b" });
    expect(unreadTotalOf(out)).toBe(0);
    expect(out?.pages[0]?.items[0]?.last_message?.preview).toBe("a b");
    expect(applySentMessage(d, uid(7), msg(1, 2))).toBe(d);
  });
});
