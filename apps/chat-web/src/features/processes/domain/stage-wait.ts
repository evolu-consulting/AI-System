// HUB-FR-143 · P-d1 · FD6: suy trạng thái chờ của một giai đoạn từ `StageView` (thuần, không đồng hồ). Bản sao ở admin-web.
export type StageWaitFacts = {
  status: string;
  retryCount?: number;
  nextRetryAt?: string;
  wait?: { dueAt: string; timeZone: string };
};

export type StageWaitInfo =
  | { kind: "retrying"; n: number; nextAt?: string }
  | { kind: "waiting_date"; dueAt: string; timeZone: string }
  | { kind: "waiting" }
  | { kind: "skipped" }
  | { kind: "none" };

/** Thứ tự: skipped → next_retry_at (retry) → wait → waiting_timer trơn → (running/queued có retryCount>0 ⇒ retrying) → none. */
export function describeStageWait(f: StageWaitFacts): StageWaitInfo {
  if (f.status === "skipped") return { kind: "skipped" };
  if (f.nextRetryAt)
    return { kind: "retrying", n: Math.max(1, f.retryCount ?? 0), nextAt: f.nextRetryAt };
  if (f.wait) return { kind: "waiting_date", dueAt: f.wait.dueAt, timeZone: f.wait.timeZone };
  if (f.status === "waiting_timer") return { kind: "waiting" };
  if ((f.status === "running" || f.status === "queued") && (f.retryCount ?? 0) > 0)
    return { kind: "retrying", n: f.retryCount as number };
  return { kind: "none" };
}

/** Hẹn ngày sớm nhất trong các giai đoạn (cho dòng trạng thái run); không có ⇒ null. Hoà ⇒ giai đoạn đứng trước. */
export function earliestWait(
  stages: readonly StageWaitFacts[],
): { dueAt: string; timeZone: string } | null {
  let best: { dueAt: string; timeZone: string } | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const s of stages) {
    if (!s.wait) continue;
    const ms = Date.parse(s.wait.dueAt);
    if (Number.isNaN(ms) || ms >= bestMs) continue;
    bestMs = ms;
    best = { dueAt: s.wait.dueAt, timeZone: s.wait.timeZone };
  }
  return best;
}
