import { describe, expect, test } from "bun:test";
import { FLOW_STEP_KINDS } from "@ai/contracts/flow";
import { genericStepKind, STEP_KINDS, stepKindSpec } from "./registry";

describe("registry loại bước", () => {
  test("STEP_KINDS đủ mọi FlowStepKind (không thừa, không thiếu)", () => {
    expect(Object.keys(STEP_KINDS).sort()).toEqual([...FLOW_STEP_KINDS].sort());
  });
  test("huy hiệu theo loại: ký số, Dify; form/wait/system/review không huy hiệu", () => {
    expect(stepKindSpec("esign").badge).toBe("esign");
    expect(stepKindSpec("dify").badge).toBe("dify");
    for (const k of ["review", "form", "wait", "system"]) expect(stepKindSpec(k).badge).toBeNull();
  });
  test("loại lạ (DLC) ⇒ vẽ chung, không huy hiệu", () => {
    expect(stepKindSpec("dlc_gate")).toBe(genericStepKind);
    expect(stepKindSpec("constructor").badge).toBeNull(); // không rơi vào prototype của Object
  });
});
