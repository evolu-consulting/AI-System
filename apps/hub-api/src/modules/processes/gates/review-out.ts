// HUB-FR-107 · HUB-FR-118 · N2-FR-02 · N2-FR-05 · hiệu ứng của `POST /review-tasks/:id/decision` theo kết quả (tách khỏi
// `gates.service.ts` cho giới hạn 400 dòng). Chạy TRONG tx quyết định (run đã khoá, task đã đóng first-wins).
// - Đạt / Chưa đạt: như P-a (`reviewEffects`); Chưa đạt có `back_to_step` ⇒ `back.effects` (P-b2).
// - N2-FR-02 Từ chối: tin `task_result` + notice đóng task ⇒ `cancelEnd` (huỷ stage/timer, đóng task khác `cancelled`, run
//   `cancelled`, `run_end`) — hậu COMMIT người gọi huỷ `hub.runs` như huỷ run (N2-D01).
import type { DecisionReason, ProcessRunStatus, ReviewDecisionRequest } from "@ai/contracts/chat";
import { processN2Error } from "../core/errors";
import { starterExcluded, starterGated } from "../domain/tasks/task-access.rules";
import { assertBackDecision, type BackOut, backFromReview } from "./back.effects";
import {
  cancelEnd,
  type Eff,
  type Gx,
  type Locked,
  needsKick,
  reviewEffects,
  snapOf,
  threadResult,
} from "./gates.effects";
import type * as g from "./gates.repo";

export type ReviewOut = BackOut & { status: ProcessRunStatus; kick: boolean };

/** N2-FR-05 · người bắt đầu run không quyết task duyệt của stage `exclude_starter` (0 câu: snapshot run đã khoá). */
export function assertNotExcludedStarter(run: Locked, idx: number, userId: string): void {
  const after = snapOf(run).stages[idx]?.after;
  if (starterExcluded(after, run.startedBy, userId)) throw processN2Error("STARTER_CANNOT_REVIEW");
}

/**
 * N2-D06 · security M1 (người dùng chốt 2026-10-19): stage `exclude_starter` ⇒ người bắt đầu cũng không quyết task `decision`
 * lý do `redo_limit`/`back_limit` (`use_current` = coi như Đạt — đường lách cấp 2). Lý do khác giữ hành vi cũ.
 */
export function assertDecisionAllowed(
  run: Locked,
  idx: number,
  userId: string,
  reason: DecisionReason,
): void {
  const after = snapOf(run).stages[idx]?.after;
  if (starterExcluded(after, run.startedBy, userId) && starterGated("decision", reason))
    throw processN2Error("STARTER_CANNOT_REVIEW");
}

/** N2-FR-05 + P-b2 · kiểm trước khi đóng task: người bắt đầu bị loại (403) ⇒ đích quay lại sai (422). */
export function assertReviewAllowed(
  run: Locked,
  idx: number,
  userId: string,
  b: ReviewDecisionRequest,
): void {
  assertNotExcludedStarter(run, idx, userId);
  assertBackDecision(run, idx, b);
}

/** N2-FR-02 · run kết thúc ở quyết duyệt (Từ chối) ⇒ huỷ `hub.runs` sau COMMIT. */
export const cancelRunOf = (run: Locked, status: ProcessRunStatus) =>
  status === "cancelled" ? { tenantId: run.tenantId } : undefined;

/** N2-FR-02 · Từ chối: task đã đóng `reject` (+ lý do) ở service; ghi tin + notice rồi kết thúc run. */
async function rejectOut(gx: Gx, e: Eff, task: g.GateTask, b: ReviewDecisionRequest) {
  const { run, idx, ref } = e;
  const [, closed] = await Promise.all([
    threadResult(gx, {
      run,
      idx,
      taskId: task.id,
      kind: "review",
      result: "reject",
      ref,
      feedback: b.feedback,
    }),
    gx.d.notifier.taskClosed(gx.tx, task.id),
  ]);
  const ended = await cancelEnd(gx, { run, idx, ref }, task.id);
  return { events: [...closed, ...ended], step: null, status: "cancelled" as const, kick: false };
}

/** P-b2 · Chưa đạt có `back_to_step` ⇒ `back.effects`; N2 · Từ chối ⇒ `rejectOut`; còn lại như P-a (`reviewEffects`). */
export async function reviewOut(
  gx: Gx,
  e: Eff,
  task: g.GateTask,
  b: ReviewDecisionRequest,
): Promise<ReviewOut> {
  if (b.result === "reject") return rejectOut(gx, e, task, b);
  if (b.result !== "fail" || b.back_to_step === undefined) {
    const o = await reviewEffects(gx, e, task, b);
    return { ...o, status: e.next.status, kick: needsKick(e.effects, o.step) };
  }
  const { run, idx, ref } = e;
  const fb = b.feedback ?? "";
  const o = await backFromReview(gx, { run, idx, ref, task, feedback: fb, target: b.back_to_step });
  return { ...o, status: "needs_decision", kick: o.step?.kind === "next_step" };
}
