// ADM-FR-42 · mock:quota — phần thuần (tham số, hàng mẫu).
import { describe, expect, test } from "bun:test";
import { parseArgs, runRows, seedRows } from "./quota";

describe("mock:quota", () => {
  test("parseArgs: đủ tham số", () => {
    expect(
      parseArgs([
        "--tenant",
        "acme",
        "--runs",
        "1001",
        "--quota",
        "1000",
        "--feature",
        "dich",
        "--seed",
      ]),
    ).toEqual({ tenant: "acme", runs: 1001, quota: 1000, feature: "dich", seed: true });
  });
  test("parseArgs: thiếu tenant / sai số / tham số lạ → ném", () => {
    expect(() => parseArgs(["--runs", "1"])).toThrow();
    expect(() => parseArgs(["--tenant", "a", "--runs", "0"])).toThrow();
    expect(() => parseArgs(["--tenant", "a", "--x"])).toThrow();
    expect(() => parseArgs(["--tenant", "a"])).toThrow();
  });
  test("runRows: hàng thứ > quota là overage", () => {
    const rows = runRows(
      { tenant: "a", runs: 1001, quota: 1000, feature: null, seed: false },
      new Date(),
    );
    expect(rows).toHaveLength(1001);
    expect(rows.filter((r) => r.overage)).toHaveLength(1);
    expect(rows[1000]?.overage).toBe(true);
    expect(rows[0]).toMatchObject({ billable: 0.1, cost: 0.06 });
  });
  test("seedRows: 60 ngày, 3 feature, 1 hàng feature null, 1 hàng billable null", () => {
    const rows = seedRows(new Date());
    expect(new Set(rows.map((r) => r.feature).filter(Boolean)).size).toBe(3);
    expect(rows.filter((r) => r.feature === null)).toHaveLength(1);
    expect(rows.filter((r) => r.billable === null)).toHaveLength(1);
  });
});
