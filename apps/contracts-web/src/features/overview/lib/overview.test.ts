// nav-v2 · Tổng quan: luật thuần — nhóm trạng thái, số ngày còn lại, đối tác CHÚ Ý.
import { describe, expect, test } from "bun:test";
import type { ContractFacets, PartnerRow } from "@ai/contracts";
import {
  counterparty,
  daysLeft,
  EXPIRING_QS,
  groupCounts,
  partnersToReview,
  WORK_PREVIEW,
} from "./overview";

const facets = (status: { v: string; n: number }[]) => ({ status }) as unknown as ContractFacets;
const partner = (name: string, score: number | null, band: PartnerRow["band"]) =>
  ({ name, score, band, party: name, role: "customer", reason: "" }) as unknown as PartnerRow;

describe("groupCounts", () => {
  test("gộp 9 trạng thái vào 3 nhóm và cộng tổng", () => {
    const g = groupCounts(
      facets([
        { v: "needs_review", n: 2 },
        { v: "extracting", n: 1 },
        { v: "active", n: 5 },
        { v: "expiring", n: 3 },
        { v: "expired", n: 4 },
        { v: "renewed", n: 1 },
      ]),
    );
    expect(g.counts).toEqual({ pending: 3, active: 8, done: 5 });
    expect(g.total).toBe(16);
  });
  test("chưa có dữ liệu ⇒ 0", () => {
    expect(groupCounts(undefined)).toEqual({
      total: 0,
      counts: { pending: 0, active: 0, done: 0 },
    });
  });
});

describe("daysLeft", () => {
  test("còn n ngày / hôm nay / đã quá, qua ranh giới tháng và năm", () => {
    expect(daysLeft("2026-12-01", "2026-10-20")).toBe(42);
    expect(daysLeft("2026-10-20", "2026-10-20")).toBe(0);
    expect(daysLeft("2026-10-18", "2026-10-20")).toBe(-2);
    expect(daysLeft("2027-01-02", "2026-12-30")).toBe(3);
  });
  test("thiếu ngày ⇒ null", () => {
    expect(daysLeft(null, "2026-10-20")).toBeNull();
    expect(daysLeft("2026-10-20", undefined)).toBeNull();
  });
});

describe("counterparty", () => {
  test("HĐ bán ⇒ bên mua; HĐ mua/không rõ ⇒ bên bán; trống ⇒ bên còn lại", () => {
    expect(counterparty({ direction: "sale", seller: "A", buyer: "B" })).toBe("B");
    expect(counterparty({ direction: "purchase", seller: "A", buyer: "B" })).toBe("A");
    expect(counterparty({ direction: null, seller: null, buyer: "B" })).toBe("B");
    expect(counterparty({ direction: null, seller: null, buyer: null })).toBe("");
  });
});

describe("partnersToReview", () => {
  test("chỉ mức CHÚ Ý, điểm thấp trước", () => {
    const rows = [
      partner("Beta", 63, "watch"),
      partner("Alpha", 80, "good"),
      partner("Gamma", 55, "watch"),
      partner("Delta", null, null),
    ];
    expect(partnersToReview(rows).map((p) => p.name)).toEqual(["Gamma", "Beta"]);
    expect(partnersToReview(undefined)).toEqual([]);
  });
});

describe("hằng số", () => {
  test("6 việc xem trước; truy vấn sắp hết hiệu lực sắp theo ngày hết hạn tăng dần", () => {
    expect(WORK_PREVIEW).toBe(6);
    expect(EXPIRING_QS).toContain("status=expiring");
    expect(EXPIRING_QS).toContain("sort=end_date&dir=asc");
  });
});
