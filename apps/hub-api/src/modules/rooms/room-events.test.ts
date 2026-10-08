// HUB-FR-99 · unit `memberAddedEvents` gộp (review X2a RV1 #8): thêm N người vào phòng M người ⇒ mỗi người nhận đúng 1
// `room.member_added`; người mới nhận bản kèm `room`, người cũ nhận 1 bản chung (không N×M).
import { describe, expect, test } from "bun:test";
import type { RoomSummary } from "@ai/contracts/chat";
import { memberAddedEvents } from "./room-events";

const ROOM = "a2a00000-0000-4000-8000-000000000001";
const u = (n: number) => `a2a00000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const summary = { id: ROOM } as unknown as RoomSummary;

describe("HUB-FR-99 · memberAddedEvents", () => {
  test("HUB-FR-99 · thêm 3 người vào phòng 4 người ⇒ 3 bản riêng + 1 bản chung cho 4 người cũ", () => {
    const old = [u(1), u(2), u(3), u(4)];
    const added = [u(5), u(6), u(7)].map((userId) => ({ userId, room: summary }));
    const evs = memberAddedEvents(ROOM, added, [...old, ...added.map((a) => a.userId)]);
    expect(evs).toHaveLength(4);
    const perUser = new Map<string, number>();
    for (const e of evs) for (const id of e.userIds) perUser.set(id, (perUser.get(id) ?? 0) + 1);
    expect([...perUser.values()].every((n) => n === 1)).toBe(true);
    expect(perUser.size).toBe(7);
    expect(evs.at(-1)).toEqual({
      userIds: old,
      event: "room.member_added",
      data: { room_id: ROOM, user_id: u(5) },
    });
    expect(evs[0]?.data).toEqual({ room_id: ROOM, user_id: u(5), room: summary });
  });

  test("HUB-FR-99 · tạo nhóm (không người cũ) ⇒ chỉ bản riêng; không ai được thêm ⇒ rỗng", () => {
    const added = [u(1), u(2)].map((userId) => ({ userId, room: summary }));
    expect(memberAddedEvents(ROOM, added, [])).toHaveLength(2);
    expect(memberAddedEvents(ROOM, [], [u(1)])).toEqual([]);
  });
});
