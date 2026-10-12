// CHAT-AC-59 · AC-PB2-01 · luật thuần gom bước.
import { describe, expect, test } from "bun:test";
import { groupBySteps, groupRound, showSteps, stepNo } from "./steps";

const s = (idx: number, step?: number, round?: number) => ({ idx, step, round });

describe("groupBySteps", () => {
  test("thiếu step ⇒ mỗi giai đoạn một bước (idx)", () => {
    const g = groupBySteps([s(0), s(1), s(2)]);
    expect(g.map((x) => [x.step, x.items.length])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });
  test("có step ⇒ gom song song, bước tăng dần", () => {
    const g = groupBySteps([s(0, 0), s(1, 1), s(2, 1), s(3, 2)]);
    expect(g.map((x) => x.items.map((i) => i.idx))).toEqual([[0], [1, 2], [3]]);
  });
  test("thiếu step ở một phần tử ⇒ cả run dùng idx (như resolveSteps)", () => {
    const g = groupBySteps([s(0, 0), s(1), s(2, 1)]);
    expect(g.map((x) => x.step)).toEqual([0, 1, 2]);
  });
  test("rỗng ⇒ []", () => {
    expect(groupBySteps([])).toEqual([]);
  });
});

describe("showSteps / groupRound / stepNo", () => {
  test("tuần tự, round 1 ⇒ ẩn nhãn", () => {
    expect(showSteps([s(0), s(1)])).toBe(false);
    expect(showSteps([s(0, 0, 1), s(1, 1, 1)])).toBe(false);
  });
  test("có bước song song hoặc round>1 ⇒ hiện", () => {
    expect(showSteps([s(0, 0), s(1, 1), s(2, 1)])).toBe(true);
    expect(showSteps([s(0, 0, 2), s(1, 1)])).toBe(true);
  });
  test("groupRound lấy lớn nhất; stepNo +1", () => {
    const g = groupBySteps([s(0, 0, 3), s(1, 0, 1)])[0];
    expect(g && groupRound(g)).toBe(3);
    expect(stepNo(0)).toBe(1);
  });
});
