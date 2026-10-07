// HUB-FR-99 · HUB-FR-100 · sự kiện thuần (test-plan X2a §5.1 R15r–R19r; plan §8 `room-events.ts`, plan-db §5:
// `UserEvent = {userIds, event, data}`). Chỉ phủ 3 hàm có chữ ký đầy đủ ở plan §8; `memberAddedEvents`/`updatedEvents`/
// `deletedEvents` (chữ ký "…") phủ ở int S04, S05, O15 (test-plan §9 G13).
import { describe, expect, it } from "bun:test";
import { loadRoomEvents } from "../_modules";

const R = "a2a00000-0000-4000-8000-000000000f01";
const A = "a2a00000-0000-4000-8000-00000000000a";
const B = "a2a00000-0000-4000-8000-00000000000b";
const E = "a2a00000-0000-4000-8000-00000000000e";
type Ev = { userIds: string[]; event: string; data: Record<string, unknown> };
/** Phẳng hoá thành `user|event` (bỏ thứ tự). */
const pairs = (evs: Ev[]) => evs.flatMap((e) => e.userIds.map((u) => `${u}|${e.event}`)).sort();
const forUser = (evs: Ev[], u: string, event: string) =>
  evs.filter((e) => e.event === event && e.userIds.includes(u));

const msg = {
  id: "a2a00000-0000-4000-8000-000000000f02",
  room_id: R,
  seq: 4,
  sender_type: "user",
  sender: { id: A, display_name: "lan" },
  content: "Xin chào",
  client_msg_id: "a2a00000-0000-4000-8000-000000000f03",
  created_at: "2026-10-07T01:00:00.000Z",
};

describe("R15r–R19r · room-events [X2a-R19 · R20]", () => {
  it("HUB-FR-99 · R15r · messageEvents: room.message cho mọi thành viên GỒM người gửi; room.unread {room_id, unread, total} mỗi người theo fanout [X2a-R20]", async () => {
    const m = await loadRoomEvents();
    const fanout = [
      { user_id: A, unread: 0, total: 2 },
      { user_id: B, unread: 1, total: 5 },
      { user_id: E, unread: 4, total: 4 },
    ];
    const evs: Ev[] = m.messageEvents(R, msg, fanout);
    for (const u of [A, B, E]) {
      const got = forUser(evs, u, "room.message");
      expect(got.length).toBe(1);
      expect(got[0]?.data).toEqual({ room_id: R, message: msg });
    }
    expect(forUser(evs, B, "room.unread")[0]?.data).toEqual({ room_id: R, unread: 1, total: 5 });
    expect(forUser(evs, E, "room.unread")[0]?.data).toEqual({ room_id: R, unread: 4, total: 4 });
    expect(forUser(evs, A, "room.unread")[0]?.data).toEqual({ room_id: R, unread: 0, total: 2 });
    expect(pairs(evs).filter((p) => p.endsWith("room.message")).length).toBe(3);
  });

  it("HUB-FR-100 · R16r · readEvents: room.read {room_id, user_id, seq} cho thành viên KHÁC, không cho chính mình [X2a-R19]", async () => {
    const m = await loadRoomEvents();
    const evs: Ev[] = m.readEvents(R, B, 3, [A, B, E], { unread: 0, total: 1 });
    expect(forUser(evs, B, "room.read")).toEqual([]);
    for (const u of [A, E])
      expect(forUser(evs, u, "room.read")[0]?.data).toEqual({ room_id: R, user_id: B, seq: 3 });
  });

  it("HUB-FR-100 · R17r · readEvents: chính mình nhận room.unread (đồng bộ tab), người khác không nhận room.unread [X2a-R18]", async () => {
    const m = await loadRoomEvents();
    const evs: Ev[] = m.readEvents(R, B, 3, [A, B, E], { unread: 0, total: 1 });
    const mine = forUser(evs, B, "room.unread");
    expect(mine.length).toBe(1);
    expect(mine[0]?.data).toMatchObject({ room_id: R, unread: 0, total: 1 });
    expect(forUser(evs, A, "room.unread")).toEqual([]);
  });

  it("HUB-FR-99 · R18r · memberRemovedEvents: người bị bớt CÓ trong người nhận (đúng 1) + mọi người còn lại [X2a-R20]", async () => {
    const m = await loadRoomEvents();
    const evs: Ev[] = m.memberRemovedEvents(R, B, [A, E]);
    expect(pairs(evs)).toEqual(
      [`${A}|room.member_removed`, `${B}|room.member_removed`, `${E}|room.member_removed`].sort(),
    );
    for (const e of evs) expect(e.data).toEqual({ room_id: R, user_id: B });
  });

  it("HUB-FR-99 · R19r · không người nhận trùng trong một sự kiện (mỗi user một lần) [X2a-R20]", async () => {
    const m = await loadRoomEvents();
    const evs: Ev[] = [
      ...m.messageEvents(R, msg, [
        { user_id: A, unread: 0, total: 0 },
        { user_id: B, unread: 1, total: 1 },
      ]),
      ...m.memberRemovedEvents(R, B, [A]),
    ];
    const p = pairs(evs);
    expect(new Set(p).size).toBe(p.length);
  });
});
