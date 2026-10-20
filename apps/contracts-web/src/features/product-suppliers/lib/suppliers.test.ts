// V2-J2 · luật hiển thị thuần của tab NCC & giá.
import { describe, expect, it } from "bun:test";
import type { SupplierPriceRow, SupplierSearchItem } from "@ai/contracts";
import { hasRenew, isOld, rowsOfKind, supplierTabVisible, toSaveItems } from "./suppliers";

const row = (kind: "new" | "renew"): SupplierPriceRow => ({
  id: null,
  supplier_name: "A",
  party_key: null,
  kind,
  price: 1,
  unit: null,
  source: "manual",
  url: null,
  on: null,
  vs_own_pct: null,
  reputation: null,
});

describe("V2-J2 · supplier tab lib", () => {
  it("tab ẩn với Giới thiệu", () => {
    expect(supplierTabVisible("referral")).toBe(false);
    expect(supplierTabVisible("goods")).toBe(true);
    expect(supplierTabVisible("service")).toBe(true);
  });
  it("Mua mới / Gia hạn", () => {
    const rows = [row("new"), row("renew"), row("new")];
    expect(hasRenew(rows)).toBe(true);
    expect(hasRenew([row("new")])).toBe(false);
    expect(rowsOfKind(rows, "new")).toHaveLength(2);
  });
  it("giá cũ > 180 ngày", () => {
    expect(isOld("2026-04-24", "2026-10-21")).toBe(false);
    expect(isOld("2026-04-20", "2026-10-21")).toBe(true);
    expect(isOld(null, "2026-10-21")).toBe(false);
  });
  it("kết quả AI ⇒ thân lưu nguồn market", () => {
    const i: SupplierSearchItem = {
      supplier_name: "FPT",
      kind: "renew",
      price: 90_000,
      unit: "cái",
      url: "https://fpt.vn",
      seen_on: null,
      note: null,
    };
    expect(toSaveItems([i])).toEqual([{ ...i, source: "market" }]);
  });
});
