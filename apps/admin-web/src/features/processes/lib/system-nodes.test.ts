import { describe, expect, test } from "bun:test";
import {
  isSlotStep,
  isSystemStage,
  isSystemToolKey,
  isSystemToolStage,
  SYSTEM_TOOL_KEYS,
} from "./system-nodes";

const tool = (key: string, slotRaw?: Record<string, unknown>) => ({
  executor: "tool",
  tool: { key },
  ...(slotRaw ? { slotRaw } : {}),
});

describe("system-nodes", () => {
  test("hai tool hệ thống của khe contracts.approval", () => {
    expect(SYSTEM_TOOL_KEYS).toEqual(["contracts-route", "contracts-finalize"]);
  });
  test("isSystemStage: chỉ route/finalize (tool hệ thống không mang slot.kind)", () => {
    expect(isSystemStage(tool("contracts-route"))).toBe(true);
    expect(isSystemStage(tool("contracts-finalize"))).toBe(true);
    // finalize mang slot.esign (không có `kind`) vẫn là nút hệ thống
    expect(isSystemStage(tool("contracts-finalize", { esign: { kind: "esign" } }))).toBe(true);
    // bước duyệt/Dify của khe (cũng gọi contracts-route) KHÔNG khoá
    expect(isSystemStage(tool("contracts-route", { kind: "review" }))).toBe(false);
    expect(isSlotStep(tool("contracts-route", { kind: "review" }))).toBe(true);
    expect(isSystemStage(tool("xuat-hd"))).toBe(false);
    expect(isSystemStage({ executor: "agent:1", tool: { key: "contracts-route" } })).toBe(false);
  });
  test("isSystemToolStage: mọi stage gọi tool hệ thống (kể cả bước duyệt) ⇒ không kiểm theo catalog", () => {
    expect(isSystemToolStage(tool("contracts-route", { kind: "review" }))).toBe(true);
    expect(isSystemToolStage(tool("xuat-hd"))).toBe(false);
  });
  test("isSystemToolKey chịu null", () => {
    expect(isSystemToolKey(null)).toBe(false);
    expect(isSystemToolKey("contracts-route")).toBe(true);
  });
});
