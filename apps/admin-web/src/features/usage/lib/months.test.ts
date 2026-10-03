// ADM-FR-42 · M4-R01 · kỳ báo cáo theo tháng.
import { describe, expect, test } from "bun:test";
import { currentMonth, deltaPct, monthRange, previousMonth, recentMonths } from "./months";

describe("months", () => {
  test("currentMonth theo giờ VN (cuối tháng UTC đã sang tháng sau)", () => {
    expect(currentMonth(new Date("2026-09-30T18:00:00Z"))).toBe("2026-10");
    expect(currentMonth(new Date("2026-10-03T00:00:00Z"))).toBe("2026-10");
  });
  test("recentMonths: 12 tháng, qua năm", () => {
    const m = recentMonths(new Date("2026-02-10T00:00:00Z"));
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2026-02");
    expect(m[2]).toBe("2025-12");
    expect(m[11]).toBe("2025-03");
  });
  test("monthRange / previousMonth", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
  test("deltaPct", () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(5, 0)).toBeNull();
  });
});
