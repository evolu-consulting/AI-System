// gap-d1 #19 · bảng rủi ro phụ thuộc NCC của SP (BA KN-09).
import { describe, expect, it } from "bun:test";
import type { ProductSourceOut } from "@ai/contracts";
import { dependencyRisk, levelOf } from "./product-sources.rules";

const src = (name: string, lead: number | null = null): ProductSourceOut => ({
  id: name,
  supplier_name: name,
  party_key: name,
  lead_days: lead,
  moq: null,
  price_ref: null,
  note: null,
  created_at: "2026-10-01T00:00:00Z",
});

describe("levelOf", () => {
  it("không dự phòng: ≥70% high, ≥50% medium, còn lại low", () => {
    expect([levelOf(80, false), levelOf(50, false), levelOf(49, false)]).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });
  it("có dự phòng: ≥70% medium, còn lại low", () => {
    expect([levelOf(95, true), levelOf(60, true)]).toEqual(["medium", "low"]);
  });
});

describe("dependencyRisk", () => {
  it("không NCC nào ⇒ rỗng, không phải nguồn đơn", () => {
    expect(dependencyRisk([], [])).toEqual({ risk: [], single_source: false });
  });
  it("một NCC duy nhất (đã mua) ⇒ nguồn đơn, high", () => {
    const r = dependencyRisk([], [{ party_key: "a", name: "A", amount: 100 }]);
    expect(r.single_source).toBe(true);
    expect(r.risk).toMatchObject([
      { supplier_name: "A", share_pct: 100, declared: false, level: "high" },
    ]);
  });
  it("hợp NCC đã mua + đã khai báo; tỉ trọng làm tròn; sắp theo tỉ trọng", () => {
    const r = dependencyRisk(
      [src("B", 7), src("C")],
      [
        { party_key: "a", name: "A", amount: 800 },
        { party_key: "B", name: null, amount: 200 },
      ],
    );
    expect(r.single_source).toBe(false);
    expect(r.risk.map((x) => [x.supplier_name, x.share_pct, x.declared, x.level])).toEqual([
      ["A", 80, false, "medium"],
      ["B", 20, true, "low"],
      ["C", 0, true, "low"],
    ]);
    expect(r.risk.find((x) => x.party_key === "B")?.lead_days).toBe(7);
  });
});
