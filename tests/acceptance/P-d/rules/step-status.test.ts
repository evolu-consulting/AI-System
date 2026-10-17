// HUB-FR-144 · HUB-BR-42 · AC-H41 · test-plan §4 PD-U27…U29: trạng thái gate/run theo bước với `waiting_timer`
// `P/domain/runs/step.rules.ts` (plan-domain §4.4: `stageGateStatus`, `runStatusOf`, `statusForRun`, `stepJoin` — chữ ký cũ
// như `P-b2/rules/step-rules.test.ts`). Module vắng ⇒ đỏ.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "runs/step.rules.ts";

describe("PD-U27…U29 · step.rules với waiting_timer [plan-domain §4.4]", () => {
  it("AC-H41 · PD-U27 · stageGateStatus(running, waiting_timer) = waiting_timer; runStatusOf ưu tiên ... > waiting_review > waiting_timer", async () => {
    const g = await domainFn(REL, "stageGateStatus");
    expect(g("running", "waiting_timer")).toBe("waiting_timer");
    const r = await domainFn(REL, "runStatusOf");
    expect([
      r(["waiting_timer"]),
      r(["waiting_timer", "running"]),
      r(["waiting_timer", "waiting_review"]),
      r(["needs_decision", "waiting_timer"]),
    ]).toEqual(["waiting_timer", "running", "waiting_review", "needs_decision"]);
  });
  it("AC-H39 · PD-U28 · statusForRun: backoff retry ⇒ queued; wait_until ⇒ waiting_timer; running ⇒ running", async () => {
    const f = await domainFn(REL, "statusForRun");
    expect([
      f("waiting_timer", "retry"),
      f("waiting_timer", "wait_until"),
      f("running", null),
    ]).toEqual(["queued", "waiting_timer", "running"]);
  });
  it("AC-H41 · PD-U29 · stepJoin bước 1 {1:done, 2:waiting_timer} ⇒ wait (chưa step_done)", async () => {
    const statuses = new Map([
      [1, "done"],
      [2, "waiting_timer"],
    ]);
    expect((await domainFn(REL, "stepJoin"))({ steps: [0, 1, 1, 2], step: 1, statuses })).toEqual({
      kind: "wait",
    });
  });
});
