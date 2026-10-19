// HD-FR-33 · HD-FR-37 · D3-02: ngưỡng cấp 2 theo tenant (mặc định 500 tr, đúng ngưỡng ⇒ cấp 2, trống ⇒ cấp 2).
import { describe, expect, test } from "bun:test";
import { APPROVAL_DEFAULTS, needsLevel2 } from "./approval-def.rules";

describe("HD-FR-33 · HD-FR-37 · needsLevel2", () => {
  test("mặc định intake câu 3: 500.000.000, editor cấp 1, owner cấp 2; đúng ngưỡng ⇒ cấp 2 (≥)", () => {
    expect(APPROVAL_DEFAULTS).toEqual({
      threshold: 500_000_000,
      level1GroupKey: "contracts-editor",
      level2GroupKey: "contracts-owner",
    });
    expect(needsLevel2(245_000_000, 500_000_000)).toBe(false);
    expect(needsLevel2(500_000_000, 500_000_000)).toBe(true);
    expect(needsLevel2(600_000_000, 500_000_000)).toBe(true);
  });
  test("trống / không phải số / âm ⇒ cấp 2 (an toàn)", () => {
    for (const v of [null, undefined, "245000000", Number.NaN, -1])
      expect(needsLevel2(v, 500_000_000)).toBe(true);
  });
  test("ngưỡng tenant khác: 100 tr ⇒ 245 tr cần cấp 2", () => {
    expect(needsLevel2(245_000_000, 100_000_000)).toBe(true);
  });
});
