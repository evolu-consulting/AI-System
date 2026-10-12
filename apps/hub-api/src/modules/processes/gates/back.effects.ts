// HUB-FR-118 · HUB-BR-38(d) · AC-PB2-06/07/08 · P-b2 plan §3.5–3.6, D7–D8, §7 · hiệu ứng DB "Quay lại bước X". Chạy TRONG
// tx của review/decide (đã khoá `process_runs` FOR UPDATE, task đã đóng first-wins ⇒ quay lại ∥ quay lại tuần tự hoá, kẻ
// thua 409 `REVIEW_TASK_CLOSED`). Trả `UserEvent[]` phát SAU COMMIT; `step.kind = "next_step"` ⇒ service `kick` để launcher
// chạy mọi stage `queued` của bước X. Không log nội dung.
import type { ReviewDecisionRequest } from "@ai/contracts/chat";
import type { UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import { processError } from "../core/errors";
import { firstIdxOfStep } from "../core/step.rules";
import type { StepOutcome } from "../runs/step-persist";
import { stepsOfSnap } from "../runs/step-persist";
import { toDecision } from "../runs/team-runner";
import { backAllowed, backDecisionCheck, backResetPlan } from "./back.rules";
import { type EffOut, type Gx, type Locked, snapOf, threadResult } from "./gates.effects";
import * as g from "./gates.repo";

/** Một lần quay lại đã được phép (review thường hoặc `add_attempt` của decision `back_limit`). */
export type BackApply = {
  run: Locked;
  fromIdx: number;
  target: number;
  feedback: string;
  decidedBy: string;
  /** Task review (hoặc decision) đã đóng — `process_back_events.task_id`, loại khỏi `superseded`. */
  taskId: string;
  /** D8 · `add_attempt` ⇒ `back_limit + 1` cùng lúc `back_rounds + 1`. */
  raiseLimit: boolean;
};

/** `hub.runs` cần huỷ SAU COMMIT ở scope system (`g.cancelRunsByIds`). */
export type CancelIds = { tenantId: string; runIds: string[]; teamRunIds: string[] };
/** Kết quả hiệu ứng quay lại: như `EffOut` + run cần huỷ sau COMMIT. */
export type BackOut = EffOut & { cancel?: CancelIds };

/** `back_to_steps` + bước của stage theo snapshot (def cũ ⇒ []). */
export function backStageOf(run: Locked, idx: number): { step: number; backToSteps: number[] } {
  const snap = snapOf(run) as { stages: { step?: number; after: { back_to_steps?: number[] } }[] };
  const steps = stepsOfSnap(snap);
  const after = snap.stages[idx]?.after;
  return { step: steps[idx] ?? idx, backToSteps: [...(after?.back_to_steps ?? [])] };
}

/** Kiểm `back_to_step` trên stage của task (sau khoá, trước đóng task). Sai ⇒ ném 422. */
export function assertBackDecision(run: Locked, idx: number, b: ReviewDecisionRequest): void {
  const r = backDecisionCheck(b, backStageOf(run, idx));
  if (r !== "ok") throw processError(r);
}

/**
 * plan §3.5 bước 3 · huỷ `hub.runs` + `team_runs` của stage bị reset, `superseded` mọi task mở khác, reset `stage_runs`
 * (D7, idx tăng dần), run ⇒ bước X `running` (`back_rounds + 1`, `decision = NULL`), ghi `process_back_events`.
 */
export async function applyBack(
  gx: Gx,
  p: BackApply,
): Promise<{ step: StepOutcome; cancel: CancelIds }> {
  const { tx, d } = gx;
  const { run } = p;
  const steps = stepsOfSnap(snapOf(run));
  await g.cancelStageRuns(tx, run.id, run.tenantId);
  const stages = await g.stagesForBack(tx, run.id, run.tenantId);
  const plan = backResetPlan({ steps, target: p.target, feedback: p.feedback, stages });
  const idOf = new Map(stages.map((s) => [s.idx, s.id] as const));
  const ids = plan.flatMap((r) => idOf.get(r.idx) ?? []);
  const runIds = await g.currentRunIds(tx, ids);
  const teamRunIds = await g.cancelTeamRuns(tx, run.id, run.tenantId, ids);
  const now = d.now();
  const close = { runId: run.id, tenantId: run.tenantId, now, exceptId: p.taskId };
  await g.closeOpenTasks(tx, { ...close, result: "superseded" });
  for (const r of plan) {
    const id = idOf.get(r.idx);
    if (id) await g.resetStage(tx, id, r);
  }
  const first = firstIdxOfStep(steps, p.target);
  await g.setRunBack(tx, run.id, { step: p.target, firstIdx: first, raiseLimit: p.raiseLimit });
  const rounds = plan.filter((r) => r.status === "queued").map((r) => r.round);
  await g.insertBackEvent(tx, {
    tenantId: run.tenantId,
    runId: run.id,
    taskId: p.taskId,
    fromStageIdx: p.fromIdx,
    fromStep: steps[p.fromIdx] ?? p.fromIdx,
    toStep: p.target,
    roundAfter: Math.max(2, ...rounds),
    feedback: p.feedback,
    decidedBy: p.decidedBy,
  });
  const step: StepOutcome = {
    kind: "next_step",
    status: "running",
    step: p.target,
    stageIdx: first,
  };
  return { step, cancel: { tenantId: run.tenantId, runIds, teamRunIds } };
}

type FromReview = {
  run: Locked;
  idx: number;
  ref: g.ActorRef;
  task: g.GateTask;
  feedback: string;
  target: number;
};

/** plan §3.5 · Chưa đạt + `back_to_step`: còn vòng ⇒ quay lại; hết ⇒ stage nguồn `needs_decision(back_limit)` (D8). */
export async function backFromReview(gx: Gx, e: FromReview): Promise<BackOut> {
  const { d, tx } = gx;
  const { run, idx, ref, task, feedback, target } = e;
  await threadResult(gx, {
    run,
    idx,
    taskId: task.id,
    kind: "review",
    result: "fail",
    ref,
    feedback,
    toStep: target,
  });
  if (!backAllowed({ backRounds: Number(run.backRounds), backLimit: Number(run.backLimit) })) {
    await g.setBackPending(tx, task.stage_run_id, target, feedback);
    const events: UserEvent[] = [...(await d.notifier.taskClosed(tx, task.id))];
    const dec = { runId: run.id, tenantId: run.tenantId, idx, stageRunId: task.stage_run_id };
    events.push(...(await toDecision(d, tx, { ...dec, reason: "back_limit" })));
    return { events, step: null };
  }
  const { step, cancel } = await applyBack(gx, {
    run,
    fromIdx: idx,
    target,
    feedback,
    decidedBy: ref.id,
    taskId: task.id,
    raiseLimit: false,
  });
  return { events: [...(await d.notifier.taskClosed(tx, task.id))], step, cancel };
}

/** plan §3.6 · decision `back_limit` + `add_attempt`: `back_limit + 1` rồi quay lại tới đích đã lưu trên stage nguồn. */
export async function backFromDecision(
  gx: Gx,
  e: { run: Locked; idx: number; ref: g.ActorRef; dtask: g.GateTask },
): Promise<BackOut> {
  const { d, tx } = gx;
  const { run, idx, ref, dtask } = e;
  const pend = await g.backPendingOf(tx, dtask.stage_run_id);
  if (!pend) throw processError("PROCESS_RUN_STATE");
  const closed = await core.closeTask(tx, dtask.id, {
    result: "add_attempt",
    at: d.now(),
    decidedBy: ref.id,
  });
  if (!closed) throw processError("REVIEW_TASK_CLOSED");
  await threadResult(gx, {
    run,
    idx,
    taskId: dtask.id,
    kind: "decision",
    result: "add_attempt",
    ref,
    toStep: pend.toStep,
  });
  const { step, cancel } = await applyBack(gx, {
    run,
    fromIdx: idx,
    target: pend.toStep,
    feedback: pend.feedback,
    decidedBy: ref.id,
    taskId: dtask.id,
    raiseLimit: true,
  });
  return { events: [...(await d.notifier.taskClosed(tx, dtask.id))], step, cancel };
}
