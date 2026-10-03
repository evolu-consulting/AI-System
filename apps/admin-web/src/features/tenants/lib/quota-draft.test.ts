// ADM-FR-40 · M4-AC02 · validate ô quota + chuyển bản nháp ↔ payload PUT.
import { describe, expect, test } from "bun:test";
import { type QuotaRow, signature, toItems, validateCell } from "./quota-draft";

const row = (over: Partial<QuotaRow>): QuotaRow => ({
  feature_id: null,
  key: null,
  name: "Cả tenant",
  runs: "",
  tokens: "",
  usd: "",
  ...over,
});

describe("validateCell", () => {
  test("trống hợp lệ", () => {
    expect(validateCell("runs", "")).toBeUndefined();
    expect(validateCell("usd", "  ")).toBeUndefined();
  });
  test("0, âm → positive; thập phân ở run/token → integer", () => {
    expect(validateCell("runs", "0")).toBe("quota.error.positive");
    expect(validateCell("tokens", "-3")).toBe("quota.error.positive");
    expect(validateCell("runs", "1.5")).toBe("quota.error.integer");
    expect(validateCell("runs", "1000")).toBeUndefined();
  });
  test("USD: tối đa 2 số lẻ, < 10^10", () => {
    expect(validateCell("usd", "1.234")).toBe("quota.error.usdFormat");
    expect(validateCell("usd", "300.5")).toBeUndefined();
    expect(validateCell("usd", "10000000000")).toBe("quota.error.usdFormat");
  });
});

describe("toItems", () => {
  test("bỏ dòng trống, đổi số, USD chuẩn hoá chuỗi", () => {
    const items = toItems([
      row({ runs: "1000" }),
      row({ feature_id: "f1", usd: "300.50" }),
      row({ feature_id: "f2" }),
    ]);
    expect(items).toEqual([
      { feature_id: null, max_runs: 1000, max_tokens: null, max_usd: null },
      { feature_id: "f1", max_runs: null, max_tokens: null, max_usd: "300.5" },
    ]);
  });
  test("dòng trống không làm bẩn", () => {
    expect(signature([row({})])).toBe(signature([]));
  });
});
