import { describe, expect, test } from "bun:test";
import { legalTotal, showLegalWarning } from "./legal-warn";

const base = {
  threshold: 5_000_000,
  deal: "sell" as const,
  total: 5_000_000,
  frameId: null,
  settledNow: false,
};

describe("showLegalWarning", () => {
  test("đủ ngưỡng, đứng riêng, còn mốc mở ⇒ cảnh báo (≥ ngưỡng)", () => {
    expect(showLegalWarning(base)).toBe(true);
    expect(showLegalWarning({ ...base, total: 4_999_999 })).toBe(false);
  });
  test("thuộc HĐ NT, tích đã giao/đã thanh toán ngay, ngưỡng 0/chưa đọc, chưa có giá trị ⇒ không", () => {
    expect(showLegalWarning({ ...base, frameId: "f" })).toBe(false);
    expect(showLegalWarning({ ...base, settledNow: true })).toBe(false);
    expect(showLegalWarning({ ...base, threshold: 0 })).toBe(false);
    expect(showLegalWarning({ ...base, threshold: undefined })).toBe(false);
    expect(showLegalWarning({ ...base, total: null })).toBe(false);
  });
});

describe("legalTotal", () => {
  test("mua/bán: giá trị nhập, trống ⇒ tự cộng; giới thiệu: hoa hồng cố định", () => {
    expect(legalTotal("buy", { total_value: 9, commission_fixed: 1 }, 7)).toBe(9);
    expect(legalTotal("buy", { total_value: null, commission_fixed: 1 }, 7)).toBe(7);
    expect(legalTotal("referral", { total_value: null, commission_fixed: 6_000_000 }, 7)).toBe(
      6_000_000,
    );
    expect(legalTotal("referral", { total_value: null, commission_fixed: null }, 7)).toBeNull();
  });
});
