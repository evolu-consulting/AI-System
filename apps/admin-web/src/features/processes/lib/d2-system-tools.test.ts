// CR-105 · B1: tool hệ thống của khe (contracts-route/finalize) không có ở catalog nền tảng ⇒ KHÔNG báo "Tool này chưa được bật".
import { describe, expect, test } from "bun:test";
import type { ProcessToolItem } from "@ai/contracts/hub-admin";
import { toolErrors, toolSubmitErrors } from "./d2-validate";
import type { StageDraft } from "./draft-types";
import { emptyStage } from "./stage-convert";

const CATALOG: ProcessToolItem[] = [
  { key: "xuat-hd", name: "Xuất HĐ", description: "x", side_effect: false, params: [] },
];
const tool = (key: string, step: number, p: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  key: `s${step}`,
  name: key,
  executor: "tool",
  tool: { key, args: {} },
  ...p,
});

describe("toolErrors · tool hệ thống của khe", () => {
  test("contracts-route / finalize / bước duyệt (cũng gọi route) không lỗi dù catalog không có", () => {
    const stages = [
      tool("contracts-route", 0, { slotRaw: { kind: "review" } }),
      tool("contracts-route", 1),
      tool("contracts-finalize", 2),
    ];
    expect(toolErrors(stages, [], CATALOG)).toEqual({});
    expect(toolSubmitErrors(stages, CATALOG)).toEqual({});
  });
  test("tool lạ khác vẫn báo (không nới lỏng cho mọi tool)", () => {
    const e = toolErrors([tool("khong-co", 0)], [], CATALOG);
    expect(Object.keys(e)).toContain("stages.0.executor.tool_key");
  });
});
