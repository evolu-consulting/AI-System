// HUB-FR-106 · HUB-BR-38(a,b) · AC-PB2-01/02/05 · lớp bước song song (P-b2 plan §2, D1/D2/D9). Thuần: `transition()` vẫn
// là máy trạng thái MỘT stage; lớp này gộp nhiều stage cùng `step` (join, trạng thái run tổng hợp, chọn decision).
import type { ProcessRunStatus, StageRunStatus, TimerKind } from "../types";

const TERMINAL_RUN: ReadonlySet<ProcessRunStatus> = new Set([
  "done",
  "cancelled",
  "failed",
  "expired",
]);

/** Chỉ số stage thuộc `step`, tăng dần. */
export function stageIdxsOfStep(steps: readonly number[], step: number): number[] {
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (s === step) out.push(i);
  });
  return out;
}

/** Số bước = bước lớn nhất + 1 (steps đã được `resolveSteps` chuẩn hoá liên tục từ 0). */
export function stepCountOf(steps: readonly number[]): number {
  return steps.length === 0 ? 0 : Math.max(...steps) + 1;
}

/** Stage nhỏ nhất của bước — giá trị `process_runs.current_stage_idx` (D4). Bước rỗng ⇒ -1. */
export function firstIdxOfStep(steps: readonly number[], step: number): number {
  return steps.indexOf(step);
}

/** Stage thuộc các bước TRƯỚC bước của `idx`, tăng dần (R05 — stage cùng bước không thấy nhau). */
export function priorStageIdxs(steps: readonly number[], idx: number): number[] {
  const mine = steps[idx];
  if (mine === undefined) return [];
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (s < mine) out.push(i);
  });
  return out;
}

/** D1 · trạng thái "run" đưa vào `transition()` dựng từ trạng thái stage (cổng ACCEPTS theo stage). */
export function stageGateStatus(run: ProcessRunStatus, stage: StageRunStatus): ProcessRunStatus {
  if (TERMINAL_RUN.has(run)) return run;
  switch (stage) {
    case "pending":
    case "queued":
    case "running":
      return "running";
    case "waiting_review":
    case "waiting_answer":
    case "needs_decision":
      return stage;
    case "done":
      return "done";
    // T8 · plan-domain §4.4 · stage chờ hẹn: không nhận sự kiện job/cổng (chỉ `cancel`/`expire` — "active").
    case "waiting_timer":
      return "waiting_timer";
    default:
      return "cancelled";
  }
}

/** PD-R15 (readiness #20) · stage đang backoff `retry` tính như `queued` cho trạng thái run; chờ `wait_until` giữ nguyên. */
export function statusForRun(s: StageRunStatus, timerKind: TimerKind | null): StageRunStatus {
  return s === "waiting_timer" && timerKind !== "wait_until" ? "queued" : s;
}

/** D2 · PD-R15 · trạng thái run tổng hợp của bước: needs_decision > running > waiting_answer > waiting_review >
 * waiting_timer; mọi stage done ⇒ `step_done` (người gọi join). Danh sách rỗng ⇒ `running`. Người gọi map qua
 * `statusForRun` trước (stage backoff `retry` ⇒ `queued`). */
export function runStatusOf(
  stepStatuses: readonly StageRunStatus[],
): ProcessRunStatus | "step_done" {
  const has = (s: StageRunStatus) => stepStatuses.includes(s);
  if (has("needs_decision")) return "needs_decision";
  if (has("pending") || has("queued") || has("running")) return "running";
  if (has("waiting_answer")) return "waiting_answer";
  if (has("waiting_review")) return "waiting_review";
  if (has("waiting_timer")) return "waiting_timer";
  if (stepStatuses.length > 0 && stepStatuses.every((s) => s === "done")) return "step_done";
  return "running";
}

export type Join =
  | { kind: "wait" }
  | { kind: "next_step"; step: number; queue: number[] }
  | { kind: "finish" };

/** Mọi stage của `step` = done ⇒ bước kế (hoặc finish ở bước cuối); thiếu hàng/chưa xong ⇒ wait. */
export function stepJoin(p: {
  steps: readonly number[];
  step: number;
  statuses: ReadonlyMap<number, StageRunStatus>;
}): Join {
  const idxs = stageIdxsOfStep(p.steps, p.step);
  if (idxs.length === 0 || !idxs.every((i) => p.statuses.get(i) === "done"))
    return { kind: "wait" };
  const next = p.step + 1;
  if (next >= stepCountOf(p.steps)) return { kind: "finish" };
  return { kind: "next_step", step: next, queue: stageIdxsOfStep(p.steps, next) };
}

/** D9 · decision mở cần xử lý: `want` có mặt ⇒ nó (không mở ⇒ null); vắng ⇒ cũ nhất (hoà ⇒ stage nhỏ hơn). */
export function pickDecisionStage(
  open: readonly { stageIdx: number; createdAt: string }[],
  want?: number,
): number | null {
  if (want !== undefined) return open.some((o) => o.stageIdx === want) ? want : null;
  let best: { stageIdx: number; at: number } | null = null;
  for (const o of open) {
    const at = Date.parse(o.createdAt);
    if (!best || at < best.at || (at === best.at && o.stageIdx < best.stageIdx))
      best = { stageIdx: o.stageIdx, at };
  }
  return best ? best.stageIdx : null;
}

/** HUB-BR-38(b) · stage "Hành động thật": MỌI stage của bước liền trước phải là `review` đã Đạt; người xác nhận = người
 * Đạt MUỘN nhất. Rỗng / có auto / chưa done / thiếu passedBy ⇒ không đạt. */
export function realActionStepCheck(
  prev: readonly {
    after: "review" | "auto";
    status: StageRunStatus;
    passedBy: string | null;
    passedAt: string | null;
  }[],
): { ok: true; passedBy: string } | { ok: false } {
  if (prev.length === 0) return { ok: false };
  let last: { by: string; at: number } | null = null;
  for (const p of prev) {
    if (p.after !== "review" || p.status !== "done" || !p.passedBy) return { ok: false };
    const at = p.passedAt ? Date.parse(p.passedAt) : 0;
    if (!last || at >= last.at) last = { by: p.passedBy, at };
  }
  return last ? { ok: true, passedBy: last.by } : { ok: false };
}
