// HUB-FR-129 · P-c2 · FC12 · FC13 · FC14: nhãn thuần của khối kết quả Áp.
import { describe, expect, test } from "bun:test";
import { applyErrKey, applyOf, gateLineKey, prLinkOk, sha7 } from "./apply-view";

describe("prLinkOk (FC12)", () => {
  test("chỉ https hợp lệ", () => {
    expect(prLinkOk({ pr_url: "https://github.com/o/r/pull/1" })).toBe(true);
    expect(prLinkOk({ pr_url: "http://github.com/o/r/pull/1" })).toBe(false);
    expect(prLinkOk({ pr_url: "javascript:alert(1)" })).toBe(false);
    expect(prLinkOk({ pr_url: "https://" })).toBe(false);
    expect(prLinkOk({ pr_url: null })).toBe(false);
  });
});

describe("gateLineKey (FC13)", () => {
  test("bảng luật", () => {
    expect(gateLineKey(undefined)).toBeNull();
    expect(gateLineKey({ apply_mode: null, apply_base: null })).toBeNull();
    expect(gateLineKey({ apply_mode: undefined, apply_base: undefined })).toBeNull();
    expect(gateLineKey({ apply_mode: "branch_only", apply_base: null })).toBe("local");
    expect(gateLineKey({ apply_mode: "branch_only", apply_base: "main" })).toBe("branch_only");
    expect(gateLineKey({ apply_mode: "pr", apply_base: "main" })).toBe("pr");
    expect(gateLineKey({ apply_mode: "auto_merge", apply_base: "main" })).toBe("auto_merge");
    expect(gateLineKey({ apply_mode: "pr", apply_base: null })).toBeNull();
  });
});

describe("applyErrKey (FC14)", () => {
  test("8 mã ⇒ khoá riêng; mã lạ/null ⇒ chung", () => {
    expect(applyErrKey("auth")).toBe("process.common.apply.err.auth");
    expect(applyErrKey("unsupported_provider")).toBe(
      "process.common.apply.err.unsupported_provider",
    );
    expect(applyErrKey("zzz")).toBe("process.common.apply.genericErr");
    expect(applyErrKey(null)).toBe("process.common.apply.genericErr");
    expect(applyErrKey("toString")).toBe("process.common.apply.genericErr");
  });
});

describe("applyOf / sha7", () => {
  test("ưu tiên stage idx, rồi stage Áp mới nhất", () => {
    const a = { status: "pr_opened" } as never;
    const b = { status: "failed" } as never;
    const stages = [{ idx: 0, apply: a }, { idx: 1 }, { idx: 2, apply: b }];
    expect(applyOf(stages, 0)).toBe(a);
    expect(applyOf(stages, 1)).toBe(b);
    expect(applyOf(stages)).toBe(b);
    expect(applyOf([{ idx: 0 }])).toBeUndefined();
  });
  test("sha7", () => {
    expect(sha7("b2c3d4e5f6")).toBe("b2c3d4e");
    expect(sha7(null)).toBeNull();
  });
});
