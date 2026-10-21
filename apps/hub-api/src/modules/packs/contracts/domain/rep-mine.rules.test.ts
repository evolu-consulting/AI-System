import { describe, expect, it } from "bun:test";
import { mineFrom, mineSummary } from "./rep-mine.rules";

const r = (o: Partial<Parameters<typeof mineSummary>[0][number]>) => ({
  deal: "sell" as const,
  party: "tax:1",
  name: null,
  total: 0,
  late: 0,
  fault_ours: 0,
  fault_partner: 0,
  fault_unknown: 0,
  ...o,
});

describe("C10 · uy tín của mình", () => {
  it("gom đúng hạn / trễ / lỗi / đối tác bị ghi lỗi", () => {
    const s = mineSummary(
      [
        r({ party: "tax:1", name: "Tân Phát", total: 5, late: 2, fault_partner: 2 }),
        r({ deal: "buy", party: "tax:2", total: 3, late: 1, fault_ours: 1 }),
        r({ party: "tax:3", total: 2, late: 1, fault_unknown: 1 }),
      ],
      90,
    );
    expect(s).toMatchObject({
      total: 10,
      late: 4,
      on_time_pct: 60,
      by_fault: { ours: 1, partner: 2, unknown: 1 },
      by_deal: [
        { deal: "sell", total: 7, late: 3 },
        { deal: "buy", total: 3, late: 1 },
      ],
      blamed: [{ party: "tax:1", name: "Tân Phát", late: 2 }],
    });
  });
  it("chưa có mốc ⇒ on_time_pct null; khoảng ngày", () => {
    expect(mineSummary([], 90).on_time_pct).toBeNull();
    expect(mineFrom("2026-03-05", 90)).toBe("2025-12-05");
  });
});
