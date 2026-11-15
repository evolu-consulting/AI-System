// CR-152 · luật thuần: ô hiện/ẩn, thân PUT, tiền tính ra khi ghi kỳ (khớp máy chủ).
import { describe, expect, it } from "bun:test";
import {
  coopShares,
  franchiseFee,
  monthsLeft,
  termsDirty,
  termsOfServer,
  termsToPut,
  unsureTerms,
  visibleKeys,
} from "./kind-terms";

describe("kind-terms", () => {
  it("Bộ Công Thương chỉ hiện khi bên nhượng quyền ở nước ngoài", () => {
    expect(visibleKeys("franchise", {}).has("moit_registered")).toBe(false);
    const v = visibleKeys("franchise", { foreign_franchisor: "1" });
    expect(v.has("moit_registered")).toBe(true);
    expect(v.has("moit_registered_on")).toBe(true);
  });

  it("Nhượng quyền: tỷ lệ hoặc số tiền theo cách tính phí, Hợp tác không chia ẩn phần chia", () => {
    expect(visibleKeys("franchise", { fee_basis: "fixed" }).has("fee_pct")).toBe(false);
    expect(visibleKeys("franchise", { fee_basis: "revenue_pct" }).has("fee_fixed")).toBe(false);
    const none = visibleKeys("cooperation", { split_basis: "none" });
    expect(none.has("our_share_pct")).toBe(false);
    expect(visibleKeys("cooperation", { split_basis: "profit" }).has("our_share_pct")).toBe(true);
  });

  it("thân PUT: số kiểu Việt, ô rỗng/ẩn ⇒ null, % ngoài 0–100 ⇒ bad", () => {
    const ok = termsToPut("franchise", {
      brand: " Cà Phê Mẫu ",
      initial_fee: "300.000.000",
      fee_basis: "revenue_pct",
      fee_pct: "5,5",
      fee_fixed: "999",
      foreign_franchisor: "0",
      moit_registered: "1",
    });
    expect(ok.bad).toEqual([]);
    expect(ok.body).toMatchObject({
      brand: "Cà Phê Mẫu",
      initial_fee: 300_000_000,
      fee_pct: 5.5,
      fee_fixed: null,
      foreign_franchisor: false,
      moit_registered: null,
    });
    expect(termsToPut("cooperation", { split_basis: "profit", our_share_pct: "120" }).bad).toEqual([
      "our_share_pct",
    ]);
  });

  it("đọc từ máy chủ + so sánh bẩn", () => {
    const saved = termsOfServer({ brand: "A", exclusive: true, fee_pct: 5, x: null });
    expect(saved).toEqual({ brand: "A", exclusive: "1", fee_pct: "5" });
    expect(termsDirty("franchise", { ...saved }, saved)).toBe(false);
    expect(termsDirty("franchise", { ...saved, brand: "B" }, saved)).toBe(true);
  });

  it("ô AI chưa chắc tô vàng tới khi người sửa", () => {
    const saved = { brand: "A" };
    expect(unsureTerms(["terms.brand", "title"], { brand: "A" }, saved).has("brand")).toBe(true);
    expect(unsureTerms(["terms.brand"], { brand: "B" }, saved).size).toBe(0);
  });

  it("phí kỳ Nhượng quyền: 5% × 820 triệu + 1% quảng cáo = 49,2 triệu, cố định thì lấy số cố định", () => {
    expect(franchiseFee({ fee_basis: "revenue_pct", fee_pct: 5 }, 820_000_000)).toBe(41_000_000);
    expect(franchiseFee({ fee_basis: "revenue_pct", fee_pct: 5, ad_fee_pct: 1 }, 820_000_000)).toBe(
      49_200_000,
    );
    expect(franchiseFee({ fee_basis: "fixed", fee_fixed: 10_000_000 }, 1)).toBe(10_000_000);
    expect(franchiseFee({ fee_basis: "revenue_pct" }, 100)).toBeNull();
  });

  it("chia Hợp tác: mình 60% của 500 triệu = 300 triệu, đối tác 200 triệu, tổng đúng từng đồng", () => {
    expect(coopShares({ our_share_pct: 60 }, 500_000_000)).toEqual({
      our: 300_000_000,
      partner: 200_000_000,
    });
    const s = coopShares({ our_share_pct: 33.33 }, 1_001);
    expect((s?.our ?? 0) + (s?.partner ?? 0)).toBe(1_001);
    expect(coopShares({}, 5)).toBeNull();
  });

  it("số tháng còn hiệu lực", () => {
    expect(monthsLeft("2026-12-01", "2029-11-30")).toBe(35);
    expect(monthsLeft("2026-12-01", "2029-12-01")).toBe(36);
    expect(monthsLeft("2030-01-01", "2029-12-01")).toBeNull();
    expect(monthsLeft("2026-12-01", null)).toBeNull();
  });
});
