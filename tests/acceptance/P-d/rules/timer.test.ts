// HUB-FR-143 · HUB-FR-144 · AC-H39 · AC-H41 · test-plan §4 PD-U38…U40: tới hạn / hành động bắn / huỷ khi quay lại
// `P/domain/timers/timer.rules.ts` (plan-domain §4.11, PD-R11/R12). Module vắng ⇒ đỏ.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "timers/timer.rules.ts";
const N = new Date("2026-10-19T01:00:00.000Z");
const at = (ms: number) => new Date(N.getTime() + ms);

describe("PD-U38…U40 · timer.rules [plan-domain §4.11]", () => {
  it("AC-H41 · PD-U38 · isDue: now N−1 ms f; N t; N+1 ms t; đã fired f; đã cancelled f", async () => {
    const f = await domainFn(REL, "isDue");
    const t = { dueAt: N, firedAt: null, cancelledAt: null };
    expect([
      f(t, at(-1)),
      f(t, N),
      f(t, at(1)),
      f({ ...t, firedAt: N }, at(1)),
      f({ ...t, cancelledAt: N }, at(1)),
    ]).toEqual([false, true, true, false, false]);
  });
  it("AC-H39 · PD-U39 · fireAction: retry+waiting_timer ⇒ requeue; wait_until+waiting_timer ⇒ finish_wait; stage đã đổi / run kết thúc ⇒ drop", async () => {
    const f = await domainFn(REL, "fireAction");
    expect([
      f("retry", "waiting_timer", false),
      f("wait_until", "waiting_timer", false),
      f("retry", "queued", false),
      f("wait_until", "waiting_timer", true),
    ]).toEqual([{ kind: "requeue" }, { kind: "finish_wait" }, { kind: "drop" }, { kind: "drop" }]);
  });
  it("AC-H41 · PD-U40 · stagesToCancelOnBack: stage step 0…3, toStep 1 ⇒ id step 1, 2, 3", async () => {
    const f = await domainFn(REL, "stagesToCancelOnBack");
    const stages = [0, 1, 2, 3].map((step) => ({ stageRunId: `s${step}`, step }));
    expect([...f(stages, 1)].sort()).toEqual(["s1", "s2", "s3"]);
  });
});
