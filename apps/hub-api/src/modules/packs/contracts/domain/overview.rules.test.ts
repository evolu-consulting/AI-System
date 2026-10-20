// V2-K · TQ-02 · BA §4.1/§5.4: kỳ + kỳ trước, 12 cột, gom 4 con số, % so kỳ trước, theo nhóm.
import { describe, expect, it } from "bun:test";
import {
  addMonths,
  buildOverview,
  type MonthRow,
  overviewRange,
  pctChange,
} from "./overview.rules";

const row = (m: string, o: Partial<MonthRow> = {}): MonthRow => ({
  m,
  rev_exp: 0,
  rev_act: 0,
  comm_exp: 0,
  comm_act: 0,
  profit: 0,
  cost_missing: false,
  service: 0,
  goods: 0,
  ...o,
});

describe("V2-K · kỳ", () => {
  it("tháng / quý lịch / 12 tháng gần nhất + kỳ trước cùng độ dài; cửa sổ 24 tháng tới hết kỳ", () => {
    expect(overviewRange("2026-10-21", "month")).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
      prev_from: "2026-09-01",
      prev_to: "2026-09-30",
      window_from: "2025-11-01",
    });
    expect(overviewRange("2026-11-05", "quarter")).toMatchObject({
      from: "2026-10-01",
      to: "2026-12-31",
      prev_from: "2026-07-01",
      prev_to: "2026-09-30",
    });
    const y = overviewRange("2026-02-10", "12m");
    expect([y.from, y.to, y.prev_from, y.prev_to]).toEqual([
      "2025-03-01",
      "2026-02-28",
      "2024-03-01",
      "2025-02-28",
    ]);
    expect(y.months).toHaveLength(12);
    expect([y.months[0], y.months[11]]).toEqual(["2025-03", "2026-02"]);
    expect(overviewRange("2026-11-05", "quarter").months[11]).toBe("2026-12");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("% thay đổi: 1 chữ số; kỳ trước 0 ⇒ null", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(1, 3)).toBe(-66.7);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe("V2-K · 4 con số + theo nhóm", () => {
  it("cộng tháng trong kỳ; chưa thu = dự kiến − thực nhận; % theo thực nhận; biên trên doanh thu dự kiến", () => {
    const rows = [
      row("2026-09", { rev_exp: 100, rev_act: 50, comm_act: 10, profit: 30, goods: 100 }),
      row("2026-10", {
        rev_exp: 200,
        rev_act: 75,
        comm_exp: 40,
        comm_act: 20,
        profit: 90,
        cost_missing: true,
        service: 120,
        goods: 80,
      }),
    ];
    const o = buildOverview(rows, 5_000, "2026-10-21", "month");
    expect(o.revenue).toEqual({
      expected: 200,
      actual: 75,
      outstanding: 125,
      prev_actual: 50,
      change_pct: 50,
    });
    expect(o.commission).toMatchObject({
      expected: 40,
      actual: 20,
      outstanding: 20,
      change_pct: 100,
    });
    expect(o.gross_profit).toEqual({
      amount: 90,
      margin_pct: 25,
      prev_amount: 30,
      change_pct: 200,
      cost_missing: true,
    });
    expect(o.stock_held.value).toBe(5_000);
    const g = Object.fromEntries(o.groups.map((x) => [x.group, x]));
    expect([g.service?.total, g.goods?.total, g.referral?.total]).toEqual([120, 80, 40]);
    expect(g.goods?.change_pct).toBe(-20);
    expect(g.referral?.basis).toBe("commission_expected");
    expect(g.service?.months.at(-1)).toEqual({ month: "2026-10", value: 120 });
    expect(g.service?.months.at(-2)).toEqual({ month: "2026-09", value: 0 });
  });
});

describe("V2-K · 4 con số + theo nhóm (không dữ liệu)", () => {
  it("không có dữ liệu ⇒ 0, biên null", () => {
    const o = buildOverview([], 0, "2026-10-21", "12m");
    expect(o.revenue.outstanding).toBe(0);
    expect(o.gross_profit.margin_pct).toBeNull();
    expect(o.groups.every((x) => x.months.length === 12)).toBe(true);
  });
});
