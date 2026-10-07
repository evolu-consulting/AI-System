// X2a · luật thuần phòng.
import { describe, expect, test } from "bun:test";
import type { RoomMessage } from "@ai/contracts/chat";
import { dayKey, groupByDay, lastSeqOf, previewOf, roomTitle, seenBy } from "./room-logic";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const m = (seq: number, sender: string, at = "2026-10-07T10:00:00"): RoomMessage => ({
  id: `00000000-0000-4000-8000-0000000001${String(seq).padStart(2, "0")}`,
  room_id: ME,
  seq,
  sender_type: "user",
  sender: { id: sender, display_name: sender === ME ? "Me" : "Bo" },
  content: "x",
  client_msg_id: null,
  created_at: at,
});
const member = (id: string, last: number) => ({
  id,
  display_name: "n",
  username: "u",
  role: "member" as const,
  last_read_seq: last,
  joined_at: "2026-10-07T00:00:00.000Z",
});

describe("room-logic", () => {
  test("roomTitle: nhóm = name, DM = peer", () => {
    expect(roomTitle({ kind: "group", name: "Dự án", peer: null })).toBe("Dự án");
    const peer = { id: OTHER, display_name: "Bo", username: "bo" };
    expect(roomTitle({ kind: "dm", name: null, peer })).toBe("Bo");
  });
  test("previewOf", () => {
    expect(previewOf({ last_message: null }, ME)).toBeNull();
    const last_message = {
      seq: 1,
      sender_type: "user" as const,
      sender: { id: ME, display_name: "Me" },
      preview: "hi",
      created_at: "2026-10-07T00:00:00.000Z",
    };
    expect(previewOf({ last_message }, ME)).toEqual({ who: "you", name: "Me", text: "hi" });
    expect(previewOf({ last_message }, OTHER)?.who).toBe("other");
  });
  test("seenBy: tin cuối của mình, người khác đã đọc tới", () => {
    const msgs = [m(1, ME), m(2, OTHER), m(3, ME)];
    const detail = { members: [member(ME, 3), member(OTHER, 3), member("c", 2)] };
    expect(seenBy(detail, msgs, ME).readers.map((x) => x.id)).toEqual([OTHER]);
    expect(seenBy(detail, [m(2, OTHER)], ME)).toEqual({ messageId: null, readers: [] });
  });
  test("groupByDay / lastSeqOf", () => {
    const g = groupByDay([
      m(1, ME, "2026-10-06T10:00:00"),
      m(2, ME, "2026-10-07T10:00:00"),
      m(3, ME, "2026-10-07T11:00:00"),
    ]);
    expect(g.map((x) => x.items.length)).toEqual([1, 2]);
    expect(dayKey("2026-10-07T10:00:00")).toBe("2026-10-07");
    expect(lastSeqOf([m(1, ME), m(5, ME), m(3, ME)])).toBe(5);
    expect(lastSeqOf([])).toBe(0);
  });
});
