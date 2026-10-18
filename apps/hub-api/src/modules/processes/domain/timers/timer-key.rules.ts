// HUB-FR-143 · HUB-FR-144 · PD-R10 · plan-domain §4.10 · plan-addendum A7 Q9: khoá idempotency của hẹn giờ
// `<kind>:<stageRunId>:<round>:<attempt>:<n>` (UNIQUE `process_timers_key_uq`). Thuần, lớp 1.
import type { TimerKind } from "../types";

/** `n` = số hẹn cùng loại của stage (mọi attempt/round) + 1 ⇒ ≥ 1; sai ⇒ ném (lỗi lập trình, không phải nghiệp vụ). */
export function timerKey(k: {
  kind: TimerKind;
  stageRunId: string;
  round: number;
  attempt: number;
  n: number;
}): string {
  if (!Number.isInteger(k.n) || k.n < 1) throw new RangeError("timerKey: n phải ≥ 1");
  return `${k.kind}:${k.stageRunId}:${k.round}:${k.attempt}:${k.n}`;
}
