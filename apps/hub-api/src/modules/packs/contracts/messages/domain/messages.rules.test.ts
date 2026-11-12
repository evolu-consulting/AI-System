// CR-132 · HD-MSG-01..12 · luật thuần tin nhắn (không DB).
import { describe, expect, test } from "bun:test";
import {
  canEditGroup,
  canRemoveMember,
  capUnread,
  clampRead,
  dmKey,
  groupSizeOk,
  messageEmpty,
  nextOwner,
  seenBy,
} from "./messages.rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("dmKey", () => {
  test("không phụ thuộc thứ tự và hoa/thường", () => {
    expect(dmKey(A, B)).toBe(`${A}:${B}`);
    expect(dmKey(B, A)).toBe(dmKey(A, B));
    expect(dmKey(A.toUpperCase(), B)).toBe(dmKey(A, B));
  });
});

describe("quyền nhóm", () => {
  test("chỉ chủ nhóm sửa nhóm; 1-1 cố định", () => {
    expect(canEditGroup({ kind: "group" }, "owner")).toBe(true);
    expect(canEditGroup({ kind: "group" }, "member")).toBe(false);
    expect(canEditGroup({ kind: "direct" }, "owner")).toBe(false);
  });
  test("tự rời hoặc chủ bớt người; 1-1 không bớt được", () => {
    const member = { id: A, role: "member" } as const;
    const owner = { id: B, role: "owner" } as const;
    expect(canRemoveMember({ kind: "group" }, member, A)).toBe(true);
    expect(canRemoveMember({ kind: "group" }, member, B)).toBe(false);
    expect(canRemoveMember({ kind: "group" }, owner, A)).toBe(true);
    expect(canRemoveMember({ kind: "direct" }, owner, A)).toBe(false);
    expect(canRemoveMember({ kind: "direct" }, member, A)).toBe(false);
  });
});

describe("nextOwner", () => {
  test("người vào sớm nhất; hoà ⇒ id nhỏ; rỗng ⇒ null", () => {
    expect(
      nextOwner([
        { user_id: B, role: "member", joined_at: "2026-11-02T00:00:00Z" },
        { user_id: A, role: "member", joined_at: new Date("2026-11-01T00:00:00Z") },
      ]),
    ).toBe(A);
    expect(
      nextOwner([
        { user_id: B, role: "member", joined_at: "2026-11-01T00:00:00Z" },
        { user_id: A, role: "member", joined_at: "2026-11-01T00:00:00Z" },
      ]),
    ).toBe(A);
    expect(nextOwner([])).toBeNull();
  });
});

describe("groupSizeOk · clampRead · seenBy · messageEmpty · capUnread", () => {
  test("nhóm ≤ 50", () => {
    expect(groupSizeOk(30, 20)).toBe(true);
    expect(groupSizeOk(30, 21)).toBe(false);
    expect(groupSizeOk(50, 0)).toBe(true);
  });
  test("đã đọc chỉ tiến, không vượt tin cuối", () => {
    expect(clampRead(3, 5, 10)).toBe(5);
    expect(clampRead(7, 5, 10)).toBe(7);
    expect(clampRead(3, 99, 10)).toBe(10);
    expect(clampRead(0, 0, 0)).toBe(0);
  });
  test("người khác mình đã đọc tới seq", () => {
    const ms = [
      { user_id: A, last_read_seq: 5 },
      { user_id: B, last_read_seq: 4 },
      { user_id: "c", last_read_seq: 9 },
    ];
    expect(seenBy(ms, A, 5)).toEqual(["c"]);
    expect(seenBy(ms, "x", 4)).toEqual([A, B, "c"]);
    expect(seenBy(ms, "x", 10)).toEqual([]);
  });
  test("tin rỗng: chữ trắng + không tệp", () => {
    expect(messageEmpty("  \n ", 0)).toBe(true);
    expect(messageEmpty("", 1)).toBe(false);
    expect(messageEmpty("a", 0)).toBe(false);
  });
  test("kẹp chưa đọc 99 / 999", () => {
    expect(capUnread(150, "conversation")).toBe(99);
    expect(capUnread(1500, "total")).toBe(999);
    expect(capUnread(-1, "total")).toBe(0);
    expect(capUnread(7, "conversation")).toBe(7);
  });
});
