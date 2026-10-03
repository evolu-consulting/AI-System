import { describe, expect, test } from "bun:test";
import { isValidCustom, periodRange } from "./period";

const today = new Date(2026, 9, 3, 12, 0, 0);

describe("ADM-FR-51 · periodRange", () => {
  test("preset 7 ngày gồm hôm nay", () => {
    expect(periodRange({ kind: "preset", days: 7 }, today)).toEqual({
      from: "2026-09-27",
      to: "2026-10-03",
    });
  });
  test("preset 30 ngày qua tháng", () => {
    expect(periodRange({ kind: "preset", days: 30 }, today)).toEqual({
      from: "2026-09-04",
      to: "2026-10-03",
    });
  });
  test("tuỳ chọn giữ nguyên", () => {
    expect(periodRange({ kind: "custom", from: "2026-01-01", to: "2026-01-31" }, today)).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });
  test("isValidCustom", () => {
    expect(isValidCustom("2026-01-01", "2026-01-01")).toBe(true);
    expect(isValidCustom("2026-02-01", "2026-01-01")).toBe(false);
    expect(isValidCustom("", "2026-01-01")).toBe(false);
  });
});
