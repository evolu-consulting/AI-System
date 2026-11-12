// CR-127 · U2b · view-model panel Duyệt.
import { describe, expect, test } from "bun:test";
import { dueToValueOf, needOf, whoPatch, whoValueOf, withDue, withDueTo } from "./approve-panel";

const esc = { on: false, afterH: "24", groupId: "" };

describe("panel Duyệt", () => {
  test("Cần: mặc định một người; head_only cũ ⇒ trưởng phòng; ghi rõ thắng", () => {
    expect(needOf({})).toBe("one");
    expect(needOf({ review: { headOnly: true } })).toBe("head");
    expect(needOf({ review: { headOnly: true, need: "all" } })).toBe("all");
  });
  test("Ai duyệt: chọn người xoá phòng, chọn phòng xoá người", () => {
    const person = whoPatch({}, "u:abc", (id) => ({ groupId: id }));
    expect(person).toMatchObject({ groupId: "", review: { approverUserId: "abc" } });
    expect(whoValueOf({ review: { approverUserId: "abc" } }, "g1")).toBe("u:abc");
    const group = whoPatch({ review: { approverUserId: "abc" } }, "g1", (id) => ({ groupId: id }));
    expect(group.groupId).toBe("g1");
    expect(group.review?.approverUserId).toBeUndefined();
  });
  test("Hạn trống ⇒ tắt; có số ⇒ bật; nơi chuyển người/phòng đúng một", () => {
    expect(withDue({ ...esc, on: true }, " ").on).toBe(false);
    expect(withDue(esc, "48")).toMatchObject({ on: true, afterH: "48" });
    const p = withDueTo(esc, "u:x");
    expect(p).toMatchObject({ userId: "x", groupId: "" });
    expect(dueToValueOf(p)).toBe("u:x");
    const g = withDueTo(p, "g:y");
    expect(g.userId).toBeUndefined();
    expect(dueToValueOf(g)).toBe("g:y");
  });
});
