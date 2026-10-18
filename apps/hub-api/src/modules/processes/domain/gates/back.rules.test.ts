// HUB-FR-118 · unit cạnh file cho `back.rules.ts` (ca biên ngoài RB-* của QC).
import { describe, expect, it } from "bun:test";
import { backDecisionCheck, backResetPlan, canRaiseBackLimit } from "./back.rules";

describe("back.rules [HUB-FR-118]", () => {
  it("không back_to_step ⇒ ok kể cả pass", () => {
    expect(backDecisionCheck({ result: "pass" }, { step: 2, backToSteps: [0] })).toBe("ok");
  });
  it("đích ≥ bước của stage ⇒ BACK_TARGET_INVALID dù có trong danh sách (dữ liệu hỏng)", () => {
    expect(
      backDecisionCheck(
        { result: "fail", feedback: "x", back_to_step: 2 },
        { step: 2, backToSteps: [2] },
      ),
    ).toBe("BACK_TARGET_INVALID");
  });
  it("stage bước X chưa từng chạy (pending) ⇒ queued, round giữ", () => {
    const got = backResetPlan({
      steps: [0, 1],
      target: 0,
      feedback: "f",
      stages: [
        { idx: 1, status: "waiting_review", round: 1 },
        { idx: 0, status: "pending", round: 1 },
      ],
    });
    expect(got).toEqual([
      { idx: 0, status: "queued", round: 1, feedback: "f" },
      { idx: 1, status: "pending", round: 2, feedback: null },
    ]);
  });
  it("P-d2 · PD2-R15 · quay lại xuyên qua stage skipped ⇒ pending, round giữ; stage đã chạy sau nó ⇒ round + 1", () => {
    const got = backResetPlan({
      steps: [0, 1, 2, 3],
      target: 1,
      feedback: "f",
      stages: [
        { idx: 1, status: "done", round: 1 },
        { idx: 2, status: "skipped", round: 1 },
        { idx: 3, status: "waiting_review", round: 1 },
      ],
    });
    expect(got).toEqual([
      { idx: 1, status: "queued", round: 2, feedback: "f" },
      { idx: 2, status: "pending", round: 1, feedback: null },
      { idx: 3, status: "pending", round: 2, feedback: null },
    ]);
  });
  it("add_attempt chỉ nâng back_limit khi < 100 (CHECK process_runs_back_ck)", () => {
    expect(canRaiseBackLimit(3)).toBe(true);
    expect(canRaiseBackLimit(99)).toBe(true);
    expect(canRaiseBackLimit(100)).toBe(false);
  });
});
