// CR-118 · cr118-r1-fixes #4 · trần tiền của form phải là số nguyên an toàn (1e18 > MAX_SAFE_INTEGER ⇒ mất chính xác).
import { describe, expect, test } from "bun:test";
import { FORM_MONEY_MAX } from "./process-form";

describe("CR-118 · FORM_MONEY_MAX", () => {
  test("FORM_MONEY_MAX an toàn số nguyên", () => {
    expect(Number.isSafeInteger(FORM_MONEY_MAX)).toBe(true);
    expect(FORM_MONEY_MAX).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(FORM_MONEY_MAX + 1)).toBe(true);
  });
});
