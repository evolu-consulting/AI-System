// HUB-FR-143 · HUB-FR-144 · PD-R11/R12 · plan-domain §4.11: tới hạn, hành động bắn, huỷ khi quay lại. Thuần, lớp 1.
import type { StageRunStatus, Timer, TimerKind } from "../types";

export function isDue(t: Pick<Timer, "dueAt" | "firedAt" | "cancelledAt">, now: Date): boolean {
  return t.firedAt === null && t.cancelledAt === null && t.dueAt.getTime() <= now.getTime();
}

export type FireAction = { kind: "requeue" } | { kind: "finish_wait" } | { kind: "drop" };

/** retry: stage waiting_timer ⇒ requeue; wait_until: stage waiting_timer ⇒ finish_wait; khác (hoặc run kết thúc) ⇒ drop. */
export function fireAction(
  kind: TimerKind,
  stageStatus: StageRunStatus,
  runTerminal: boolean,
): FireAction {
  if (runTerminal || stageStatus !== "waiting_timer") return { kind: "drop" };
  return kind === "retry" ? { kind: "requeue" } : { kind: "finish_wait" };
}

/** Quay lại tới `toStep` ⇒ stage có `step ≥ toStep` bị reset ⇒ huỷ hẹn của chúng. */
export function stagesToCancelOnBack(
  stages: readonly { stageRunId: string; step: number }[],
  toStep: number,
): string[] {
  return stages.filter((s) => s.step >= toStep).map((s) => s.stageRunId);
}
