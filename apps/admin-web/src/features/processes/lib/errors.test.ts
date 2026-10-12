// HUB-FR-104 · P-b2 (UAT L2): 422 PROCESS_DEF_INVALID có rules[] ⇒ câu lỗi theo mã luật, theo ô.
import { describe, expect, test } from "bun:test";
import { serverErrors } from "./errors";

describe("serverErrors", () => {
  test("rules song song paths: BACK_TARGET_INVALID gộp về ô back_to_steps, STEP_TOO_WIDE về ô step", () => {
    const out = serverErrors(
      "PROCESS_DEF_INVALID",
      [
        "stages.1.after.back_to_steps.0",
        "stages.1.after.back_to_steps.1",
        "stages.3.step",
        "stages.2.name",
      ],
      ["BACK_TARGET_INVALID", "BACK_TARGET_INVALID", "STEP_TOO_WIDE", "OTHER"],
    );
    expect(out).toEqual({
      "stages.1.after.back_to_steps": "process.admin.canvas.err.backTarget",
      "stages.3.step": "process.admin.canvas.err.stepFull",
      "stages.2.name": "process.admin.apiError.PROCESS_DEF_INVALID",
    });
  });
  test("không có rules ⇒ câu theo mã như trước", () => {
    expect(serverErrors("PROCESS_REF_INVALID", ["stages.0.executor"], [])).toEqual({
      "stages.0.executor": "process.admin.apiError.PROCESS_REF_INVALID",
    });
  });
});
