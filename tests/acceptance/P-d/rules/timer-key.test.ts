// HUB-FR-143 · HUB-FR-144 · AC-H39 · AC-H41 · test-plan §4 PD-U37: khoá hẹn giờ idempotent
// `P/domain/timers/timer-key.rules.ts` (plan-domain §4.10, PD-R10; plan-addendum A7 Q9). Module vắng ⇒ đỏ.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "timers/timer-key.rules.ts";

describe("PD-U37 · timerKey [plan-domain §4.10]", () => {
  it("AC-H39 · PD-U37 · {retry,s1,round 2,attempt 1,n 3} ⇒ 'retry:s1:2:1:3'; wait_until cùng mẫu", async () => {
    const f = await domainFn(REL, "timerKey");
    expect(f({ kind: "retry", stageRunId: "s1", round: 2, attempt: 1, n: 3 })).toBe(
      "retry:s1:2:1:3",
    );
    expect(f({ kind: "wait_until", stageRunId: "s2", round: 1, attempt: 1, n: 1 })).toBe(
      "wait_until:s2:1:1:1",
    );
  });
  it("AC-H39 · PD-U37 · n = 0 ⇒ ném (n ≥ 1)", async () => {
    const f = await domainFn(REL, "timerKey");
    expect(() => f({ kind: "retry", stageRunId: "s1", round: 2, attempt: 1, n: 0 })).toThrow();
  });
});
