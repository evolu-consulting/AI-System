// HUB-FR-143 · HUB-BR-41 · PD-R03/R04/R05/R06/R08 · AC-H39 · AC-H40 · plan-domain §4.2: quyết định thử lại job stage lỗi
// (còn lượt? hạn backoff 30 s/2'/8', trần `STAGE_RETRY_MAX`, chặn khi đã gửi `side_effect`). Thuần, lớp 1. Stage team
// (PD-R08) dùng CÙNG `decideRetry` với bộ đếm của `stage_runs` — khác biệt nằm ở use case.
import { RETRY_BACKOFF_S, STAGE_RETRY_MAX } from "../limits";
import type { DecisionReason } from "../types";
import type { JobErrorClass } from "./job-error.rules";

/** Bộ đếm thử lại của stage: `retryAttempt/retryRound` = (attempt, round) lúc ghi `retryCount` (reset ngầm D-PD02). */
export type RetryState = {
  retryCount: number;
  retryAttempt: number | null;
  retryRound: number | null;
  attempt: number;
  round: number;
};

/** Lượt thử hiệu lực: chỉ đếm khi (retryAttempt, retryRound) = (attempt, round); khác ⇒ 0 (PD-R06). */
export function effectiveRetryCount(s: RetryState): number {
  return s.retryAttempt === s.attempt && s.retryRound === s.round ? s.retryCount : 0;
}

/** Hạn bắn lần thử thứ `nextCount`: `now + RETRY_BACKOFF_S[nextCount-1]` giây (không đổi `now`). */
export function retryDueAt(now: Date, nextCount: 1 | 2 | 3): Date {
  return new Date(now.getTime() + RETRY_BACKOFF_S[(nextCount - 1) as 0 | 1 | 2] * 1000);
}

export type RetryInput = {
  cls: JobErrorClass;
  state: RetryState;
  sideEffectSent: boolean;
  legacy: "job_timeout" | "agent_failed" | "interrupted";
  now: Date;
};
export type RetryDecision =
  | { kind: "retry"; retryCount: 1 | 2 | 3; dueAt: Date }
  | { kind: "decide"; reason: DecisionReason };

/**
 * business ⇒ decide(legacy); transient ∧ đã gửi side_effect ⇒ decide(legacy) (A3, PD-R05); transient ∧ đã đủ
 * `STAGE_RETRY_MAX` lượt ⇒ decide(`retry_exhausted`); còn lại ⇒ retry(lượt kế, hạn backoff).
 */
export function decideRetry(i: RetryInput): RetryDecision {
  if (i.cls === "business" || i.sideEffectSent) return { kind: "decide", reason: i.legacy };
  const used = effectiveRetryCount(i.state);
  if (used >= STAGE_RETRY_MAX) return { kind: "decide", reason: "retry_exhausted" };
  const next = (used + 1) as 1 | 2 | 3;
  return { kind: "retry", retryCount: next, dueAt: retryDueAt(i.now, next) };
}
