// V2-I · luật thuần Đối tác UI v2: URL, gom danh sách, Góp, bước tới điểm cuối, biểu đồ + ngưỡng, lọc HĐ, sao cần lý do.
import { describe, expect, test } from "bun:test";
import type {
  PartnerContractRow,
  RepCellOut,
  RepCriterionOut,
  RepHistory,
  RepPartnerRow,
} from "@ai/contracts";
import {
  byStage,
  chartOf,
  criterionLines,
  dataPointOf,
  finalSteps,
  needsReason,
  noteOfLine,
  parsePartnersSearch,
  partiesOf,
  periodLabel,
  seriesOf,
  stageCounts,
  valueShares,
  worstOf,
} from "./partner-v2";

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

describe("V2-I URL", () => {
  test("chỉ giữ tham số hợp lệ; không có party ⇒ danh sách", () => {
    expect(parsePartnersSearch({ tab: "review" })).toEqual({});
    expect(
      parsePartnersSearch({ party: "tax:1", role: "customer", tab: "contracts", range: "6" }),
    ).toEqual({
      party: "tax:1",
      role: "customer",
      tab: "contracts",
      range: 6,
    });
    expect(parsePartnersSearch({ party: "tax:1", role: "x", tab: "overview", range: 99 })).toEqual({
      party: "tax:1",
    });
  });
});

describe("V2-I danh sách", () => {
  const row = (party: string, role: RepPartnerRow["role"], level: RepPartnerRow["level"]) =>
    ({ party, name: `N ${party}`, role, score: 80, level, jobs: 4, groups: [] }) as RepPartnerRow;
  test("gộp vai theo đối tác, kèm số HĐ, mức xấu nhất", () => {
    const l = partiesOf(
      [row("a", "customer", "good"), row("a", "supplier", "watch"), row("b", "supplier", "new")],
      new Map([["a", 3]]),
    );
    expect(l.map((p) => [p.party, p.roles.map((r) => r.role), p.contracts, p.worst])).toEqual([
      ["a", ["supplier", "customer"], 3, "watch"],
      ["b", ["supplier"], 0, "new"],
    ]);
    expect(worstOf([{ level: "good" }, { level: "fair" }])).toBe("fair");
  });
});

describe("V2-I bảng tính điểm", () => {
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

describe("V2-I biểu đồ", () => {
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

describe("V2-I HĐ theo giai đoạn", () => {
  const r = (id: string, stage: PartnerContractRow["stage"]) =>
    ({ id, stage }) as PartnerContractRow;
  test("đếm + lọc Chưa bắt đầu / Đang / Đã xong", () => {
    const rows = [
      r("1", "done"),
      r("2", "in_progress"),
      r("3", "in_progress"),
      r("4", "not_started"),
    ];
    expect(stageCounts(rows)).toEqual({ all: 4, not_started: 1, in_progress: 2, done: 1 });
    expect(byStage(rows, "in_progress").map((x) => x.id)).toEqual(["2", "3"]);
    expect(byStage(rows, "all")).toHaveLength(4);
  });
});

describe("V2-I sao + lý do", () => {
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
  test("dòng tìm internet ⇒ nội dung ghi chú", () => {
    expect(noteOfLine({ title: "T", summary: "S", source: "x.vn" })).toBe("T: S (x.vn)");
    expect(noteOfLine({ title: "T", summary: "", source: null })).toBe("T");
  });
});
