import { describe, expect, test } from "bun:test";
import { isSystemStage, isSystemToolKey, SYSTEM_TOOL_KEYS } from "./system-nodes";

describe("system-nodes", () => {
  test("hai tool hệ thống của khe contracts.approval", () => {
    expect(SYSTEM_TOOL_KEYS).toEqual(["contracts-route", "contracts-finalize"]);
  });
  test("isSystemStage: chỉ executor tool + khoá hệ thống", () => {
    expect(isSystemStage({ executor: "tool", tool: { key: "contracts-route" } })).toBe(true);
    expect(isSystemStage({ executor: "tool", tool: { key: "contracts-finalize" } })).toBe(true);
    expect(isSystemStage({ executor: "tool", tool: { key: "xuat-hd" } })).toBe(false);
    // khoá tool còn sót khi đổi executor ⇒ không khoá
    expect(isSystemStage({ executor: "agent:1", tool: { key: "contracts-route" } })).toBe(false);
  });
  test("isSystemToolKey chịu null", () => {
    expect(isSystemToolKey(null)).toBe(false);
    expect(isSystemToolKey("contracts-route")).toBe(true);
  });
});
