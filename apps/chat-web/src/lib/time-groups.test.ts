// CHAT-AC-19
import { describe, expect, test } from "bun:test";
import { groupByTime, timeGroupOf } from "./time-groups";

const now = new Date(2026, 9, 15, 14, 0, 0).getTime();
const at = (daysAgo: number, h = 10) => new Date(2026, 9, 15 - daysAgo, h, 0, 0).toISOString();

describe("timeGroupOf", () => {
  test("hôm nay, kể cả đầu ngày", () => {
    expect(timeGroupOf(at(0, 0), now)).toBe("today");
    expect(timeGroupOf(at(0, 13), now)).toBe("today");
  });
  test("hôm qua → 7 ngày; ranh giới 7 và 30 ngày", () => {
    expect(timeGroupOf(at(1, 23), now)).toBe("week");
    expect(timeGroupOf(at(7, 0), now)).toBe("week");
    expect(timeGroupOf(at(8), now)).toBe("month");
    expect(timeGroupOf(at(30, 0), now)).toBe("month");
    expect(timeGroupOf(at(31), now)).toBe("older");
  });
  test("ngày lỗi → cũ hơn", () => {
    expect(timeGroupOf("x", now)).toBe("older");
  });
});

describe("groupByTime", () => {
  test("đúng thứ tự nhóm, bỏ nhóm rỗng, giữ thứ tự trong nhóm", () => {
    const items = [
      { id: "a", updated_at: at(40) },
      { id: "b", updated_at: at(0) },
      { id: "c", updated_at: at(0, 9) },
      { id: "d", updated_at: at(10) },
    ];
    const g = groupByTime(items, now);
    expect(g.map((x) => x.group)).toEqual(["today", "month", "older"]);
    expect(g[0]?.items.map((i) => i.id)).toEqual(["b", "c"]);
  });
  test("rỗng → rỗng", () => {
    expect(groupByTime([], now)).toEqual([]);
  });
});
