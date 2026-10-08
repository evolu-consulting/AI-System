// CR-050
import { describe, expect, test } from "bun:test";
import type { DirectoryUser, RoomSummary } from "@ai/contracts/chat";
import { groupRows, peopleRows, unreadOf } from "./sidebar-rows";

const ME = "00000000-0000-4000-8000-000000000000";
const u = (n: number, name: string, username: string, active = true): DirectoryUser => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  display_name: name,
  username,
  active,
});
const THOMAS = u(1, "Thomas Tran", "thomas.tran");
const EDGAR = u(2, "Edgar Nguyen", "edgar.nguyen");
const ROWAN = u(3, "Rowan Hoang", "rowan.hoang");
const LOCKED = u(4, "Ai Đó", "ai.do", false);
const SELF = { ...u(5, "Julian Bui", "julian.bui"), id: ME };

const room = (id: string, extra: Partial<RoomSummary>): RoomSummary => ({
  id,
  kind: "group",
  name: null,
  peer: null,
  member_count: 2,
  my_role: "member",
  last_message: null,
  last_seq: 0,
  unread: 0,
  last_activity_at: "2026-10-01T00:00:00.000Z",
  ...extra,
});
const dmThomas = room("dm-t", {
  kind: "dm",
  peer: { id: THOMAS.id, display_name: THOMAS.display_name, username: THOMAS.username },
  unread: 2,
});
const team = room("g-1", { name: "Evolu team", unread: 3 });
const acb = room("g-2", { name: "Dự án ACB" });
const rooms = [team, dmThomas, acb];

describe("sidebar-rows", () => {
  test("groupRows: chỉ phòng nhóm, giữ thứ tự, lọc theo tên", () => {
    expect(groupRows(rooms, "").map((r) => r.id)).toEqual(["g-1", "g-2"]);
    expect(groupRows(rooms, " acb ").map((r) => r.id)).toEqual(["g-2"]);
  });

  test("peopleRows: DM trước, rồi người chưa nhắn theo tên; bỏ mình, người bị khoá, người đã có DM", () => {
    const rows = peopleRows(rooms, [THOMAS, ROWAN, EDGAR, LOCKED, SELF], ME, "");
    expect(rows.map((r) => (r.kind === "dm" ? `dm:${r.room.id}` : r.user.username))).toEqual([
      "dm:dm-t",
      "edgar.nguyen",
      "rowan.hoang",
    ]);
  });

  test("peopleRows: lọc theo tên hiển thị hoặc username (cả DM)", () => {
    const names = (q: string) =>
      peopleRows(rooms, [THOMAS, ROWAN, EDGAR], ME, q).map((r) =>
        r.kind === "dm" ? r.room.peer?.username : r.user.username,
      );
    expect(names("thomas.")).toEqual(["thomas.tran"]);
    expect(names("hoang")).toEqual(["rowan.hoang"]);
    expect(names("zzz")).toEqual([]);
  });

  test("peopleRows: danh bạ rỗng/lỗi vẫn còn DM", () => {
    expect(peopleRows(rooms, [], ME, "").map((r) => r.kind)).toEqual(["dm"]);
  });

  test("unreadOf: tổng chưa đọc", () => {
    expect(unreadOf(rooms)).toBe(5);
    expect(unreadOf([])).toBe(0);
  });
});
