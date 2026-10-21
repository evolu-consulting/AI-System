// ADM-FR-42 · usage-analytics · preset ngày (giờ VN), xô mặc định, ma trận cột chồng, %.
import { describe, expect, test } from "bun:test";
import { defaultGrain, deltaPct, errorPct, presetRange, sharePct, stackOf } from "./view";

const NOW = new Date("2026-10-21T20:00:00Z"); // 03:00 ngày 22/10 giờ VN

describe("ADM-FR-42 · usage-analytics view", () => {
  test("preset theo ngày VN", () => {
    expect(presetRange("7d", NOW)).toEqual({ from: "2026-10-16", to: "2026-10-22" });
    expect(presetRange("month", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-22" });
    expect(presetRange("prevMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("90d", NOW).from).toBe("2026-07-25");
  });

  test("xô mặc định theo độ dài khoảng", () => {
    expect(defaultGrain("2026-10-01", "2026-10-31")).toBe("day");
    expect(defaultGrain("2026-07-25", "2026-10-22")).toBe("week");
    expect(defaultGrain("2025-10-22", "2026-10-22")).toBe("month");
  });

  test("ma trận cột chồng: app theo tổng giảm dần, xô tăng dần, max", () => {
    const m = { input_tokens: 0, output_tokens: 0, cache_tokens: 0, calls: 1, runs: 0, errors: 0 };
    const s = stackOf([
      { bucket: "2026-10-02", app: "chat", tokens: 5, ...m },
      { bucket: "2026-10-01", app: "contracts", tokens: 30, ...m },
      { bucket: "2026-10-01", app: "chat", tokens: 10, ...m },
    ]);
    expect(s).toEqual({
      buckets: ["2026-10-01", "2026-10-02"],
      apps: ["contracts", "chat"],
      values: [
        [30, 10],
        [0, 5],
      ],
      max: 40,
    });
  });

  test("%", () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(1, 0)).toBeNull();
    expect(errorPct(1, 3)).toBe(33.3);
    expect(sharePct(1, 4)).toBe(25);
  });
});
