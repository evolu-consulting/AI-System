import { describe, expect, test } from "bun:test";
import {
  isModuleToolKey,
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
  test("tool hệ thống của khe: dlc.* (dlc-step); route/finalize của máy duyệt cũ đã gỡ", () => {
    expect(SYSTEM_TOOL_KEYS).toEqual(["dlc-step"]);
  });
  test("dlc-engine · bước DLC (dlc-step mang slot.kind dlc) là bước của khe, không khoá", () => {
    expect(isSlotStep(tool("dlc-step", { kind: "dlc" }))).toBe(true);
    expect(isSystemStage(tool("dlc-step", { kind: "dlc" }))).toBe(false);
  });
  test("isSystemStage: dlc-step không mang slot.kind khoá (tool hệ thống không mang slot.kind)", () => {
    expect(isSystemStage(tool("dlc-step"))).toBe(true);
    expect(isSystemStage(tool("contracts-route"))).toBe(false); // máy duyệt cũ đã gỡ
    expect(isSystemStage(tool("xuat-hd"))).toBe(false);
    expect(isSystemStage({ executor: "agent:1", tool: { key: "dlc-step" } })).toBe(false);
  });
  test("isSystemToolStage: mọi stage gọi tool hệ thống (kể cả bước duyệt) ⇒ không kiểm theo catalog", () => {
    expect(isSystemToolStage(tool("dlc-step", { kind: "dlc" }))).toBe(true);
    expect(isSystemToolStage(tool("xuat-hd"))).toBe(false);
  });
  test("isSystemToolKey chịu null", () => {
    expect(isSystemToolKey(null)).toBe(false);
    expect(isSystemToolKey("dlc-step")).toBe(true);
  });
});

describe("CR-127 · EO3 · tool của node module", () => {
  test("contracts-esign-send là tool module (không kiểm theo catalog nền tảng); khoá lạ thì không", () => {
    expect(isModuleToolKey("contracts-esign-send")).toBe(true);
    expect(isModuleToolKey("khong-co-tool-nay")).toBe(false);
  });
});
