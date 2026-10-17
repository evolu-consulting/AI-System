// HUB-FR-143 · HUB-BR-41 · AC-H39 · AC-H40 · test-plan §4 PD-U10…U17: thử lại tự động `P/domain/runs/retry.rules.ts`
// (plan-domain §4.2: `effectiveRetryCount`, `retryDueAt`, `decideRetry`; backoff 30 s/2'/8', trần 3). Module vắng ⇒ đỏ.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "runs/retry.rules.ts";
const N = new Date("2026-10-19T01:00:00.000Z");
const plus = (s: number) => new Date(N.getTime() + s * 1000);
/** RetryState{retryCount, retryAttempt, retryRound, attempt, round} (test-plan §4). */
const S = (c: number, ra: number | null, rr: number | null, a: number, r: number) => ({
  retryCount: c,
  retryAttempt: ra,
  retryRound: rr,
  attempt: a,
  round: r,
});
const input = (o: {
  cls: "transient" | "business";
  state?: ReturnType<typeof S>;
  sideEffectSent?: boolean;
  legacy?: "job_timeout" | "agent_failed" | "interrupted";
}) => ({
  cls: o.cls,
  state: o.state ?? S(0, null, null, 1, 1),
  sideEffectSent: o.sideEffectSent ?? false,
  legacy: o.legacy ?? "agent_failed",
  now: N,
});

describe("PD-U10…U11 · lượt thử hiệu lực + hạn backoff [plan-domain §4.2]", () => {
  it("AC-H39 · PD-U10 · effectiveRetryCount chỉ đếm khi (retryAttempt,retryRound) = (attempt,round)", async () => {
    const f = await domainFn(REL, "effectiveRetryCount");
    expect([
      f(S(2, 1, 1, 1, 1)),
      f(S(2, 1, 1, 2, 1)),
      f(S(2, 1, 1, 1, 2)),
      f(S(0, null, null, 1, 1)),
    ]).toEqual([2, 0, 0, 0]);
  });
  it("AC-H39 · PD-U11 · retryDueAt(N,1|2|3) = N+30 s / N+120 s / N+480 s; N không bị đổi", async () => {
    const f = await domainFn(REL, "retryDueAt");
    const before = N.getTime();
    expect([f(N, 1), f(N, 2), f(N, 3)]).toEqual([plus(30), plus(120), plus(480)]);
    expect(N.getTime()).toBe(before);
  });
});

describe("PD-U12…U17 · decideRetry [plan-domain §4.2, PD-R03…R06]", () => {
  it("AC-H40 · PD-U12 · business ⇒ decide(legacy agent_failed)", async () => {
    const f = await domainFn(REL, "decideRetry");
    expect(f(input({ cls: "business", legacy: "agent_failed" }))).toEqual({
      kind: "decide",
      reason: "agent_failed",
    });
  });
  it("AC-H40 · PD-U13 · transient nhưng side_effect đã gửi ⇒ decide(legacy job_timeout), không thử lại", async () => {
    const f = await domainFn(REL, "decideRetry");
    expect(f(input({ cls: "transient", sideEffectSent: true, legacy: "job_timeout" }))).toEqual({
      kind: "decide",
      reason: "job_timeout",
    });
  });
  it("AC-H39 · PD-U14 · transient lượt 0/1/2 ⇒ retry 1/2/3, hạn N+30 s/N+120 s/N+480 s", async () => {
    const f = await domainFn(REL, "decideRetry");
    expect([
      f(input({ cls: "transient", state: S(0, null, null, 1, 1) })),
      f(input({ cls: "transient", state: S(1, 1, 1, 1, 1) })),
      f(input({ cls: "transient", state: S(2, 1, 1, 1, 1) })),
    ]).toEqual([
      { kind: "retry", retryCount: 1, dueAt: plus(30) },
      { kind: "retry", retryCount: 2, dueAt: plus(120) },
      { kind: "retry", retryCount: 3, dueAt: plus(480) },
    ]);
  });
  it("AC-H39 · PD-U15 · transient đã 3 lượt ⇒ decide retry_exhausted", async () => {
    const f = await domainFn(REL, "decideRetry");
    expect(f(input({ cls: "transient", state: S(3, 1, 1, 1, 1) }))).toEqual({
      kind: "decide",
      reason: "retry_exhausted",
    });
  });
  it("AC-H39 · PD-U16 · reset ngầm: attempt mới / round mới ⇒ retry lượt 1 (hạn N+30 s)", async () => {
    const f = await domainFn(REL, "decideRetry");
    const want = { kind: "retry", retryCount: 1, dueAt: plus(30) };
    expect(f(input({ cls: "transient", state: S(3, 1, 1, 2, 1) }))).toEqual(want);
    expect(f(input({ cls: "transient", state: S(3, 1, 1, 1, 2) }))).toEqual(want);
  });
  it("AC-H39 · PD-U17 · transient legacy interrupted, hết 3 lượt ⇒ retry_exhausted (không interrupted)", async () => {
    const f = await domainFn(REL, "decideRetry");
    expect(f(input({ cls: "transient", legacy: "interrupted", state: S(3, 1, 1, 1, 1) }))).toEqual({
      kind: "decide",
      reason: "retry_exhausted",
    });
  });
});
