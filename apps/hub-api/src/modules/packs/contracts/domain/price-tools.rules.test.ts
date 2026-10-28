// com-c10a · unit: định dạng tra giá / so sánh / tìm NCC (thuần).
import { describe, expect, it } from "bun:test";
import type { HostBookOut, HostPriceOut } from "../application/host-book.ports";
import { compareResult, lookupResult, NO_PRICE, suppliersResult } from "./price-tools.rules";

const px = (o: Partial<HostPriceOut>): HostPriceOut => ({
  supplierName: "A",
  supplierPartyKey: null,
  price: 100,
  unit: "bao",
  source: "quote",
  seenOn: "2026-10-01",
  vatIncluded: null,
  expiresOn: null,
  ...o,
});
const mk = (prices: HostPriceOut[], match = true): HostBookOut => ({
  products: [
    {
      index: 0,
      hint: { name: "xi mang" },
      match: match ? { id: "i", name: "Xi măng", unit: "bao", how: "exact" } : null,
      onHand: null,
      avgCost: null,
      prices,
    },
  ],
  partners: [{ partyKey: "tax:1", band: "good", score: 90 }],
});
const P = (o: HostBookOut) => o.products[0] as HostBookOut["products"][number];

describe("com-c10a · price-tools rules", () => {
  it("rỗng / không khớp ⇒ chưa có giá", () => {
    const e = mk([]);
    expect(lookupResult(P(e), e).message).toContain(NO_PRICE);
    const n = mk([], false);
    expect(lookupResult(P(n), n).message).toContain(NO_PRICE);
    expect(compareResult(P(e), e).message).toContain(NO_PRICE);
    expect(suppliersResult(P(e), e).message).toBeTruthy();
  });
  it("tra giá: mỗi dòng có nguồn, ngày, VAT, uy tín", () => {
    const o = mk([px({ supplierPartyKey: "tax:1", vatIncluded: true })]);
    const r = lookupResult(P(o), o);
    expect(r.prices?.[0]).toMatchObject({ source: "quote", date: "2026-10-01", vat: "gồm VAT" });
    expect(r.prices?.[0]?.reputation?.band).toBe("good");
  });
  it("so sánh: cùng đơn vị, rẻ nhất, cờ VAT, loại khác đơn vị, lọc NCC, mới nhất mỗi NCC", () => {
    const o = mk([
      px({ supplierName: "B", price: 90, vatIncluded: true }),
      px({ supplierName: "A", price: 80, vatIncluded: false }),
      px({ supplierName: "A", price: 10, seenOn: "2026-01-01" }),
      px({ supplierName: "C", price: 5, unit: "tấn" }),
    ]);
    const r = compareResult(P(o), o);
    expect(r.rows?.map((x) => x.supplier)).toEqual(["A", "B"]);
    expect(r.cheapest?.supplier).toBe("A");
    expect(r.vat_warning).toBeTruthy();
    expect(r.excluded_other_unit?.[0]?.supplier).toBe("C");
    expect(compareResult(P(o), o, ["b"]).rows?.map((x) => x.supplier)).toEqual(["B"]);
  });
});
