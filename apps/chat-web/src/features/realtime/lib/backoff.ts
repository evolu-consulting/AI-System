// HUB-FR-100 · nối lại /me/stream: 0,5 · 1 · 2 · 4 · 8 s, trần 8 s, KHÔNG bỏ cuộc (plan-frontend §3).
const DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;
/** Từ lần thất bại liên tiếp thứ này, phase là `down` (banner đỏ) nhưng vẫn tiếp tục thử. */
export const DOWN_AFTER_FAILURES = 5;
/** Quá ngần này ms không nhận byte nào (server ping 15 s) → coi là chết, đóng và nối lại. */
export const IDLE_TIMEOUT_MS = 45_000;

/** `attempt` đếm từ 1. */
export function backoffDelay(attempt: number): number {
  return DELAYS_MS[Math.min(Math.max(attempt, 1), DELAYS_MS.length) - 1] as number;
}
