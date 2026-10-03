// ADM-FR-40 · M4-R02 · hàm phụ của quotas.rules (ngoài bộ test khoá của qc): tiền micro, chuẩn hoá USD, so bộ.
import { describe, expect, it } from "bun:test";
import { canonicalUsd, normalizeQuotaItems, sameQuotaSet, toMicro } from "./quotas.rules";

const F = "01900000-0000-7000-8000-000000000431";
const it3 = (f: string | null, runs: number | null, usd: string | null) => ({
  feature_id: f,
  max_runs: runs,
  max_tokens: null,
  max_usd: usd,
});

describe("ADM-FR-40 · quotas.rules phụ", () => {
  it("toMicro: '212.40' → 212400000n; '0.000001' → 1n; '-1.5' → -1500000n; chuỗi hỏng → ném", () => {
    expect(toMicro("212.40")).toBe(212_400_000n);
    expect(toMicro("0.000001")).toBe(1n);
    expect(toMicro("-1.5")).toBe(-1_500_000n);
    expect(() => toMicro("1e3")).toThrow();
  });

  it("canonicalUsd: '300' / '300.5' / '0.01' → 2 số lẻ; null giữ null", () => {
    expect([canonicalUsd("300"), canonicalUsd("300.5"), canonicalUsd("0.01")]).toEqual([
      "300.00",
      "300.50",
      "0.01",
    ]);
    expect(canonicalUsd(null)).toBeNull();
  });

  it("sameQuotaSet: không kể thứ tự; '300' bằng '300.00' sau normalize; khác giới hạn → false", () => {
    const a = normalizeQuotaItems([it3(null, 1000, null), it3(F, null, "300")]);
    const b = normalizeQuotaItems([it3(F, null, "300.00"), it3(null, 1000, null)]);
    expect(sameQuotaSet(a, b)).toBe(true);
    expect(sameQuotaSet(a, normalizeQuotaItems([it3(null, 1001, null), it3(F, null, "300")]))).toBe(
      false,
    );
    expect(sameQuotaSet(a, a.slice(1))).toBe(false);
  });
});
