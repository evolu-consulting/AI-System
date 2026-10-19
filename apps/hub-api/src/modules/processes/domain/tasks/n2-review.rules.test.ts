// N2-FR-02 · N2-FR-05 · luật thuần: Từ chối (bắt buộc lý do, kết thúc run) + người bắt đầu không duyệt stage `exclude_starter`.
import { describe, expect, test } from "bun:test";
import { reviewDecisionCheck } from "../../gates/gate.rules";
import { type RunState, transition } from "../runs/run-state.rules";
import { canAct, starterExcluded, starterGated } from "./task-access.rules";

const state: RunState = {
  status: "waiting_review",
  stageIdx: 0,
  stageCount: 2,
  stage: {
    status: "waiting_review",
    attempt: 1,
    attemptLimit: 4,
    asksCount: 0,
    askLimit: 3,
    after: "review",
    hasOutput: true,
  },
  decisionReason: null,
};

describe("N2-FR-02 · Từ chối", () => {
  test("reject cần lý do (trim ≠ rỗng)", () => {
    expect(reviewDecisionCheck({ result: "reject" })).toBe("FEEDBACK_REQUIRED");
    expect(reviewDecisionCheck({ result: "reject", feedback: "  " })).toBe("FEEDBACK_REQUIRED");
    expect(reviewDecisionCheck({ result: "reject", feedback: "sai" })).toBe("ok");
  });
  test("reject ⇒ run cancelled + finish_run; fail vẫn làm lại", () => {
    const r = transition(state, { kind: "review", result: "reject" });
    expect(r.ok && r.next.status).toBe("cancelled");
    expect(r.ok && r.effects).toContain("finish_run");
    const f = transition(state, { kind: "review", result: "fail" });
    expect(f.ok && f.next.status).toBe("running");
  });
});

describe("N2-FR-05 · exclude_starter", () => {
  const on = { kind: "review", exclude_starter: true };
  test("chỉ chặn người bắt đầu khi cờ bật ở stage review", () => {
    expect(starterExcluded(on, "u1", "u1")).toBe(true);
    expect(starterExcluded(on, "u1", "u2")).toBe(false);
    expect(starterExcluded({ kind: "review" }, "u1", "u1")).toBe(false);
    expect(starterExcluded({ kind: "auto" }, "u1", "u1")).toBe(false);
    expect(starterExcluded(undefined, "u1", "u1")).toBe(false);
  });
  test("canAct: starter thuộc Group duyệt ⇒ false khi cờ bật, true khi tắt", () => {
    const v = { userId: "u1", tenantId: "t", role: "member" as const, groupIds: new Set(["g"]) };
    const run = {
      tenantId: "t",
      startedBy: "u1",
      originRoom: "none" as const,
      taskAssignee: true,
      status: "waiting_review" as const,
    };
    const task = {
      kind: "review" as const,
      status: "open" as const,
      reason: null,
      userIds: new Set<string>(),
      groupId: "g",
      reviewGroupId: "g",
    };
    expect(canAct(v, { ...task, starterExcluded: true }, run)).toBe(false);
    expect(canAct(v, task, run)).toBe(true);
    // N2-D06 · security M1: decision redo_limit cũng chặn người bắt đầu; lý do khác giữ cũ.
    const dec = {
      ...task,
      kind: "decision" as const,
      reason: "redo_limit" as const,
      starterExcluded: true,
    };
    const decRun = { ...run, status: "needs_decision" as const };
    expect(canAct(v, dec, decRun)).toBe(false);
    expect(starterGated("decision", "redo_limit")).toBe(true);
    expect(starterGated("decision", "agent_failed")).toBe(false);
    expect(starterGated("review", null)).toBe(true);
  });
});
