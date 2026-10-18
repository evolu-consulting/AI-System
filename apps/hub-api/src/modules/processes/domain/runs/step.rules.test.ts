// HUB-FR-106 · ca biên lớp bước (bổ sung RS-01…RS-14 khoá ở tests/acceptance/P-b2/rules/step-rules.test.ts).
import { describe, expect, test } from "bun:test";
import {
  firstIdxOfStep,
  pickDecisionStage,
  priorStageIdxs,
  realActionStepCheck,
  runStatusOf,
  stepCountOf,
  stepJoin,
} from "./step.rules";

describe("step.rules biên [HUB-FR-106]", () => {
  test("bước rỗng / idx ngoài ⇒ -1 / []; steps rỗng ⇒ 0 bước", () => {
    expect(firstIdxOfStep([0, 1], 5)).toBe(-1);
    expect(priorStageIdxs([0, 1], 9)).toEqual([]);
    expect(stepCountOf([])).toBe(0);
  });
  test("stepJoin bước không có stage ⇒ wait (không nhảy bước)", () => {
    expect(stepJoin({ steps: [0, 1], step: 4, statuses: new Map() })).toEqual({ kind: "wait" });
  });
  test("runStatusOf: [] ⇒ running; cancelled lẫn done ⇒ running (không step_done)", () => {
    expect(runStatusOf([])).toBe("running");
    expect(runStatusOf(["done", "cancelled"])).toBe("running");
  });
  test("pickDecisionStage cùng thời điểm ⇒ stage nhỏ hơn", () => {
    const at = "2026-10-12T10:00:00.000Z";
    const open = [
      { stageIdx: 3, createdAt: at },
      { stageIdx: 1, createdAt: at },
    ];
    expect(pickDecisionStage(open)).toBe(1);
  });
  test("realActionStepCheck: passedAt null vẫn ok nếu đủ điều kiện", () => {
    const r = realActionStepCheck([
      { after: "review", status: "done", passedBy: "u1", passedAt: null },
    ]);
    expect(r).toEqual({ ok: true, passedBy: "u1" });
  });
});
