import { describe, expect, it } from "bun:test";
import { isEmptyOverview } from "./QuickStartCard";

const fig = { expected: 0, actual: 0, outstanding: 0, prev_actual: 0, change_pct: null };
const base = {
  revenue: fig,
  commission: fig,
  gross_profit: {
    amount: 0,
    margin_pct: null,
    prev_amount: 0,
    change_pct: null,
    cost_missing: false,
  },
  groups: [],
};

describe("isEmptyOverview (CR-125 UX L2)", () => {
  it("công ty chưa có số liệu ⇒ rỗng", () => {
    expect(isEmptyOverview(base)).toBe(true);
    expect(isEmptyOverview(undefined)).toBe(false);
  });
  it("có doanh thu hoặc nhóm ⇒ không rỗng", () => {
    expect(isEmptyOverview({ ...base, revenue: { ...fig, expected: 5 } })).toBe(false);
  });
});
