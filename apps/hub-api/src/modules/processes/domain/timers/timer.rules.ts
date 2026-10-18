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

export const TIMER_BACKOFF_MIN_MS = 60_000;
export const TIMER_BACKOFF_MAX_MS = 3_600_000;

/** #4 · hẹn bắn lỗi ⇒ lùi `due_at` để không chặn đầu hàng đợi: lùi = 2 × (now − hạn GỐC), kẹp [1 phút, 1 giờ] — hẹn càng
 * trễ càng lùi xa (nhân đôi theo độ trễ, không cần cột đếm lần). `originalDueAt` là hạn gốc, KHÔNG phải `due_at` đã lùi
 * (nếu dùng `due_at` đã lùi, độ trễ luôn ~0 ⇒ luôn kẹp 1 phút — R2-2): `wait_until` dựng lại từ snapshot, `retry` lấy `created_at`. */
export function failedTimerDueAt(originalDueAt: Date, now: Date): Date {
  const late = Math.max(0, now.getTime() - originalDueAt.getTime());
  const delay = Math.min(TIMER_BACKOFF_MAX_MS, Math.max(TIMER_BACKOFF_MIN_MS, late * 2));
  return new Date(now.getTime() + delay);
}
