// N4 eval 0.11 · độ đo thuần.
import { describe, expect, it } from "bun:test";
import {
  factCoverage,
  groupRank,
  percentile,
  recallAtK,
  reciprocalRank,
  rng,
  shuffle,
} from "./metrics";

const R = [
  { doc: "c5", ord: 5, text: "Điều 5. Bảo hành\nBên B đổi mới hàng lỗi" },
  { doc: "c1", ord: 5, text: "Điều 5. Bảo hành\nBên B đổi mới hàng lỗi trong vòng 30 ngày" },
  { doc: "a1", ord: 1, text: "Đơn giá CT5L-60 điều chỉnh thành 8.900 đồng" },
];

describe("N4 eval · metrics", () => {
  it("khớp đoạn vàng theo doc + chuỗi không dấu", () => {
    expect(groupRank(R, [{ doc: "c1", has: "doi moi hang loi" }])).toBe(2);
    expect(groupRank(R, [{ doc: "c9", has: "x" }])).toBe(0);
  });
  it("recall@k theo nhóm, MRR = 1/hạng đầu tiên", () => {
    const gold = [[{ doc: "a1", has: "8.900" }], [{ doc: "c1", has: "CT5L-60" }]];
    expect(recallAtK(R, gold, 3)).toBe(0.5);
    expect(recallAtK(R, gold, 1)).toBe(0);
    expect(reciprocalRank(R, gold)).toBeCloseTo(1 / 3);
    expect(Number.isNaN(recallAtK(R, [], 5))).toBe(true);
  });
  it("phủ ý đáp án trong ngữ cảnh top-k", () => {
    expect(factCoverage(R, [["8.900"], ["45 ngày"]], 3)).toBe(0.5);
  });
  it("percentile + PRNG có hạt tất định", () => {
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(shuffle([1, 2, 3, 4, 5], rng(42))).toEqual(shuffle([1, 2, 3, 4, 5], rng(42)));
  });
});
