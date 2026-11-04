// REP-v3-ui · V2-E · luật thuần hiển thị điểm vai × nhóm SP: Góp, bước tới điểm cuối, biểu đồ 3/6/12 tháng + ngưỡng 85/70, sao cần lý do.
import { describe, expect, test } from "bun:test";
import type { RepCellOut, RepCriterionOut, RepHistory } from "@ai/contracts";
import {
  chartOf,
  criterionLines,
  dataPointOf,
  finalSteps,
  needsReason,
  periodLabel,
  seriesOf,
  valueShares,
} from "./partner-v2e";

const crit = (
  key: string,
  weight: number,
  score: number | null,
  kind = "ontime",
): RepCriterionOut =>
  ({ key, label: key, kind, weight, score, n: score === null ? 0 : 3 }) as RepCriterionOut;
const cell = (
  group: string,
  value: number,
  score: number | null,
  o: Partial<RepCellOut> = {},
): RepCellOut =>
  ({
    group,
    role: "supplier",
    score,
    data_score: score,
    stars: null,
    level: "good",
    jobs: 5,
    value,
    criteria: [],
    ...o,
  }) as RepCellOut;

describe("V2-E bảng tính điểm", () => {
  test("Góp: bỏ tiêu chí chưa có dữ liệu, chia lại trọng số, tổng Góp = điểm dữ liệu", () => {
    const ls = criterionLines([crit("a", 40, 80), crit("b", 40, 100), crit("c", 20, null)]);
    expect(ls.map((l) => [l.share, l.gives])).toEqual([
      [50, 40],
      [50, 50],
      [null, null],
    ]);
    expect(ls.reduce((a, l) => a + (l.gives ?? 0), 0)).toBe(90);
    expect(criterionLines([crit("x", 10, null)])[0]?.gives).toBeNull();
  });
  test("bước tới điểm cuối: dữ liệu → sao ×20 → điểm nhóm; tỷ trọng giá trị giữa các nhóm", () => {
    const s = finalSteps(cell("service", 60, 86, { data_score: 90, stars: 3.5 }), 20);
    expect(s).toEqual({ data: 90, stars: 3.5, starsScore: 70, share: 20, score: 86 });
    const v = valueShares([
      cell("service", 75, 80),
      cell("goods", 25, 60),
      cell("referral", 10, null),
    ]);
    expect([...v]).toEqual([
      ["service", 75],
      ["goods", 25],
    ]);
    expect(
      [...valueShares([cell("service", 0, 80), cell("goods", 0, 60)])].map((x) => x[1]),
    ).toEqual([50, 50]);
  });
});

describe("V2-E biểu đồ", () => {
  const h = (over: Partial<RepHistory> = {}): RepHistory => ({
    party: "p",
    role: "supplier",
    months: 6,
    thresholds: { good_from: 85, fair_from: 70 },
    points: [
      { period: "2026-08", score: 78, level: "fair", jobs: 5 },
      { period: "2026-09", score: null, level: "new", jobs: 0 },
    ],
    current: { period: "2026-10", score: 88, level: "good", jobs: 6 },
    ...over,
  });
  test("chuỗi = đã chốt có điểm + hiện tại; cùng tháng lấy hiện tại", () => {
    expect(seriesOf(h())).toEqual([
      { period: "2026-08", score: 78 },
      { period: "2026-10", score: 88 },
    ]);
    expect(
      seriesOf(h({ current: { period: "2026-08", score: 90, level: "good", jobs: 6 } })).at(-1)
        ?.score,
    ).toBe(90);
    expect(seriesOf(undefined)).toEqual([]);
  });
  test("trục + hai đường ngưỡng TỐT/KHÁ nằm đúng chỗ điểm", () => {
    const c = chartOf(seriesOf(h()), { good_from: 85, fair_from: 70 });
    expect(c.grid[0]).toBe(50);
    expect(c.lines.map((l) => [l.label, l.at])).toEqual([
      ["fair", 70],
      ["good", 85],
    ]);
    expect(c.lines[1]?.y).toBeCloseTo(c.y(85), 5);
    expect(c.y(100)).toBeLessThan(c.y(70));
    expect(c.dots).toHaveLength(2);
    const low = chartOf([{ period: "2026-10", score: 40 }], { good_from: 85, fair_from: 30 });
    expect(low.grid[0]).toBe(30);
    expect(low.lines.map((l) => l.label)).toEqual(["good"]); // KHÁ 30 = đáy khung ⇒ không vẽ
    expect(periodLabel("2026-03")).toBe("03/26");
  });
});

describe("V2-E sao + lý do", () => {
  test("lệch > reason_gap so với dữ liệu ⇒ bắt lý do; so với điểm của tiêu chí, chưa có thì điểm dữ liệu nhóm", () => {
    expect(needsReason(5, 70, 25)).toBe(true); // 100 vs 70 = 30
    expect(needsReason(4, 70, 25)).toBe(false); // 80 vs 70 = 10
    expect(needsReason(4, 55, 25)).toBe(false); // đúng 25 chưa lệch hơn
    expect(needsReason(1, null, 25)).toBe(false);
    const c = cell("service", 1, 80, { data_score: 75 });
    expect(dataPointOf(crit("a", 10, 60), c)).toBe(60);
    expect(dataPointOf(crit("a", 10, null), c)).toBe(75);
    expect(dataPointOf(crit("m", 10, 100, "manual"), c)).toBe(75);
  });
});
