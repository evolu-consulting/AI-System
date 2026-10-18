// HUB-FR-107 · HUB-FR-109 · M5 · §3.1 · §3.4 · PF1 · hiệu ứng DB của cổng kiểm (tách khỏi `gates.service.ts` cho giới hạn
// 400 dòng). Chạy TRONG tx quyết định (đã khoá `process_runs`); trả `UserEvent[]` để service phát SAU COMMIT. Thuần DB:
// máy trạng thái (`transition`) do service gọi, đây chỉ ghi (`persist`/task/thread/notifier). Không log nội dung.
import type {
  DecideProcessRunRequest,
  DecisionReason,
  ReviewDecisionRequest,
  TaskResult,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import type { UserEvent } from "../../../lib/user-stream";
import { bindTx } from "../adapters/hub-uow";
import { writeApplyOutput } from "../adapters/runs/hub-settle";
import { resetRetry } from "../adapters/runs/retry.repo";
import { cancelTimers } from "../application/timers/cancel-timers.usecase";
import * as core from "../core/core.repo";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { enqueueThread } from "../core/thread";
import type { RunState } from "../domain/runs/run-state.rules";
import { stageGateStatus, stepCountOf } from "../domain/runs/step.rules";
import { WAIT_SKIP_TEXT, waitOutputMd } from "../domain/timers/due-at.rules";
import {
  persistStage,
  type StageWrite,
  type StepOutcome,
  stageDoneOf,
  stepsOfSnap,
} from "../runs/step-persist";
import { stageRowOf, toDecision } from "../runs/team-runner";
import * as g from "./gates.repo";

export type Locked = core.RunHead;
export type Stage = Awaited<ReturnType<typeof stageRowOf>>;
export type SnapStage = {
  step?: number; // P-b2 · vắng (def cũ) ⇒ mỗi stage một bước
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
};
/** Ngữ cảnh hiệu ứng sau khi đã khoá + chuyển trạng thái. */
export type Eff = {
  run: Locked;
  idx: number;
  next: RunState;
  effects: readonly string[];
  ref: g.ActorRef;
};
/** Phụ thuộc + tx của một lượt quyết định. */
export type Gx = { d: ProcessDeps; tx: Tx };

export const snapOf = (run: Locked) => run.snapshot as unknown as { stages: SnapStage[] };
export const notFound = () => processError("PROCESS_NOT_FOUND", { suggestions: [] });
/** Cần `kick` sau COMMIT: stage chạy lại, hoặc join sang bước kế (P-b2 §3.3). */
export const needsKick = (e: readonly string[], step: StepOutcome | null): boolean =>
  e.includes("queue_stage") || step?.kind === "next_step";
/** Kết quả hiệu ứng: sự kiện phát sau COMMIT + trạng thái bước sau ghi (null ⇒ không qua `persistStage`). */
export type EffOut = { events: UserEvent[]; step: StepOutcome | null };

export type StateIn = {
  run: Locked;
  s: Stage;
  def: SnapStage | undefined;
  idx: number;
  reason: DecisionReason | null;
};
/** P-b2 D1 · `transition` một stage: "run" dựng từ trạng thái stage; stageIdx/stageCount = bước/tổng bước. */
export function buildState(p: StateIn): RunState {
  const { run, s, def, idx } = p;
  const steps = stepsOfSnap(snapOf(run));
  const stageStatus = (s?.status ?? "running") as RunState["stage"]["status"];
  return {
    status: stageGateStatus(run.status, stageStatus),
    stageIdx: steps[idx] ?? idx,
    stageCount: stepCountOf(steps),
    stage: {
      status: stageStatus,
      attempt: Number(s?.attempt ?? 1),
      attemptLimit: Number(s?.attempt_limit ?? 4),
      asksCount: Number(s?.asks_count ?? 0),
      askLimit: Number(s?.ask_limit ?? 3),
      after: def?.after.kind ?? "auto",
      hasOutput: (s?.current_output_id ?? null) !== null,
    },
    decisionReason: p.reason,
  };
}

// T8 · `outside` theo NGƯỜI thao tác (= người scope tx). `g.isOutside` đọc `room_members` dưới RLS: người ngoài phòng
// không thấy hàng ⇒ outside (đúng). KHÔNG dùng `originRoomOf` ở đây — nó đọc `hub.rooms` mà RLS giấu với người ngoài
// phòng nên trả "deleted" (⇒ outside=false sai). roomId null / origin ≠ room ⇒ false.
const isOutside = (gx: Gx, run: Locked, userId: string) =>
  g.isOutside(gx.tx, run.originRoomId, userId);

type ResultMeta = {
  run: Locked;
  idx: number;
  taskId: string;
  kind: "review" | "decision";
  result: TaskResult;
  ref: g.ActorRef;
  feedback?: string;
  sections?: string[];
  /** P-b2 · Chưa đạt có quay lại bước (HUB-FR-118). */
  toStep?: number;
};
/** Tin thread `task_result` (Đạt/Chưa đạt/quyết định) — T8 `outside` theo người thao tác. */
export async function threadResult(gx: Gx, m: ResultMeta): Promise<void> {
  await enqueueThread(gx.tx, {
    runId: m.run.id,
    roomId: "",
    kind: "task_result",
    process_run_id: m.run.id,
    stage_idx: m.idx,
    task_id: m.taskId,
    task_kind: m.kind,
    result: m.result,
    actor: m.ref,
    outside: await isOutside(gx, m.run, m.ref.id),
    ...(m.feedback && { feedback: m.feedback }),
    ...(m.sections && { sections: m.sections }),
    ...(m.toStep !== undefined && { to_step: m.toStep }),
  });
}

/** Đạt → stage done (passed_by + đóng task KHÁC của stage — D6) + join bước; Chưa đạt → redo hoặc redo_limit→decide. */
export async function reviewEffects(
  gx: Gx,
  e: Eff,
  task: g.GateTask,
  b: ReviewDecisionRequest,
): Promise<EffOut> {
  const { d, tx } = gx;
  const { run, idx, next, effects, ref } = e;
  await threadResult(gx, {
    run,
    idx,
    taskId: task.id,
    kind: "review",
    result: b.result,
    ref,
    feedback: b.feedback,
    sections: b.sections,
  });
  const events = [...(await d.notifier.taskClosed(tx, task.id))];
  const p = { runId: run.id, tenantId: run.tenantId, stageRunId: task.stage_run_id, next };
  if (b.result === "pass") {
    const step = await passStage(gx, e, task, { ...p, done: stageDoneOf(effects) });
    if (step?.kind === "finish") events.push(...(await finish(gx, run, ref, "done")));
    return { events, step };
  }
  if (next.status === "needs_decision") {
    const dec = {
      runId: run.id,
      tenantId: run.tenantId,
      idx,
      stageRunId: task.stage_run_id,
      reason: "redo_limit" as const,
    };
    events.push(...(await toDecision(d, tx, dec)));
    return { events, step: null };
  }
  await g.writeRedo(tx, task.stage_run_id, b.feedback ?? null, b.sections ?? null);
  return { events, step: await persistStage(tx, { ...p, done: stageDoneOf(effects) }) };
}

/** Đạt: ghi người duyệt + đóng task KHÁC của stage (D6, `superseded`) rồi stage done + join bước. */
async function passStage(
  gx: Gx,
  e: Eff,
  task: g.GateTask,
  w: StageWrite,
): Promise<StepOutcome | null> {
  const { d, tx } = gx;
  await g.setStagePassed(tx, task.stage_run_id, e.ref.id, d.now());
  await g.closeOpenTasks(tx, {
    runId: e.run.id,
    tenantId: e.run.tenantId,
    result: "superseded",
    exceptId: task.id,
    now: d.now(),
    stageRunId: task.stage_run_id,
  });
  return persistStage(tx, w);
}

/** Đóng task decision + tin `task_result` + notifier (nếu có task mở). */
async function closeDecision(
  gx: Gx,
  e: Eff,
  option: DecideProcessRunRequest["option"],
  dtask: g.GateTask | null,
): Promise<UserEvent[]> {
  if (!dtask) return [];
  const { d, tx } = gx;
  const result = option as TaskResult;
  await core.closeTask(tx, dtask.id, { result, at: d.now(), decidedBy: e.ref.id });
  await threadResult(gx, {
    run: e.run,
    idx: e.idx,
    taskId: dtask.id,
    kind: "decision",
    result,
    ref: e.ref,
  });
  return d.notifier.taskClosed(tx, dtask.id);
}

/** add_attempt/use_current/cancel: đóng task decision + task_result, rồi redo/advance/openReview/finish hoặc huỷ. */
export async function decideEffects(
  gx: Gx,
  e: Eff,
  option: DecideProcessRunRequest["option"],
  dtask: g.GateTask | null,
): Promise<EffOut> {
  const { d, tx } = gx;
  const { run, idx, next, effects, ref } = e;
  const sid = dtask?.stage_run_id ?? "";
  const events: UserEvent[] = await closeDecision(gx, e, option, dtask);
  if (option === "cancel" || next.status === "cancelled") {
    events.push(...(await cancelEnd(gx, { run, idx, ref }, dtask?.id ?? null)));
    return { events, step: null };
  }
  if (effects.includes("close_open_tasks")) {
    await g.setStagePassed(tx, sid, ref.id, d.now());
    await g.closeOpenTasks(tx, {
      runId: run.id,
      tenantId: run.tenantId,
      result: "superseded",
      exceptId: dtask?.id ?? null,
      now: d.now(),
      stageRunId: sid, // D6 · chỉ task của stage được quyết
    });
  }
  // PD-R04 · `add_attempt` của `retry_exhausted`: bộ đếm thử lại về 0 (giữ `attempt`, D-PD04).
  if (effects.includes("reset_retry")) await resetRetry(tx, run.tenantId, sid);
  // PD-R14 · `use_current` của `timer_invalid`: Hub ghi .md "Bỏ chờ theo quyết định." (có `## Bàn giao`) rồi advance.
  const outputId = effects.includes("write_wait_skip")
    ? await writeWaitSkip(tx, { run, idx, stageRunId: sid, attempt: next.stage.attempt })
    : undefined;
  const step = await persistStage(tx, {
    runId: run.id,
    tenantId: run.tenantId,
    stageRunId: sid,
    next,
    done: stageDoneOf(effects),
    outputId,
  });
  if (effects.includes("open_review")) events.push(...(await openReview(gx, run, sid, idx)));
  if (step?.kind === "finish") events.push(...(await finish(gx, run, ref, "done")));
  return { events, step };
}

/** PD-R14 · output .md Hub sinh khi bỏ chờ (`waitOutputMd`, content inline như stage Áp); trả id để ghim. */
function writeWaitSkip(
  tx: Tx,
  p: { run: Locked; idx: number; stageRunId: string; attempt: number },
): Promise<string> {
  const name = (snapOf(p.run).stages[p.idx] as { name?: string } | undefined)?.name ?? "";
  return writeApplyOutput(tx, {
    tenantId: p.run.tenantId,
    runId: p.run.id,
    stageRunId: p.stageRunId,
    stageIdx: p.idx,
    attempt: p.attempt,
    md: waitOutputMd(name, WAIT_SKIP_TEXT),
  });
}

/** `end` (huỷ): huỷ `hub.runs` stage, đóng mọi stage + task còn mở, run `cancelled`, run_end + notifier. */
export async function cancelEnd(
  gx: Gx,
  e: Pick<Eff, "run" | "idx" | "ref">,
  exceptTaskId: string | null,
): Promise<UserEvent[]> {
  const { d, tx } = gx;
  const { run, ref } = e;
  const now = d.now();
  await g.cancelStageRuns(tx, run.id, run.tenantId);
  await g.cancelStages(tx, run.id, run.tenantId);
  // PD-R12 · cùng tx, run đã khoá, stage đã ghi (run → stage → timer): hẹn mở không còn bắn được.
  await cancelTimers(bindTx(tx, run.tenantId).repos, run.id, { kind: "all" }, now);
  await g.closeOpenTasks(tx, {
    runId: run.id,
    tenantId: run.tenantId,
    result: "cancelled",
    exceptId: exceptTaskId,
    now,
  });
  await g.setRunStatus(tx, run.id, "cancelled", now);
  return finish(gx, run, ref, "cancelled");
}

async function finish(
  gx: Gx,
  run: Locked,
  ref: g.ActorRef | null,
  status: "done" | "cancelled",
): Promise<UserEvent[]> {
  await enqueueThread(gx.tx, {
    runId: run.id,
    roomId: "",
    kind: "run_end",
    process_run_id: run.id,
    status,
    actor: status === "cancelled" ? ref : null,
  });
  return gx.d.notifier.runFinished(gx.tx, run.id);
}

/** M5 · `use_current` gate (lý do ≠ redo_limit): mở task review mới trên output hiện có. */
async function openReview(
  gx: Gx,
  run: Locked,
  stageRunId: string,
  idx: number,
): Promise<UserEvent[]> {
  const { d, tx } = gx;
  const def = snapOf(run).stages[idx];
  const groupId = def?.after.kind === "review" ? def.after.group_id : null;
  const stage = await stageRowOf(tx, run.id, idx);
  const taskId = await core.insertTask(tx, {
    tenantId: run.tenantId,
    runId: run.id,
    stageRunId,
    kind: "review",
    remindAt: new Date(d.now().getTime() + 86_400_000),
    outputId: stage?.current_output_id ?? null,
    userIds: [],
    groupId,
  });
  return d.notifier.taskOpened(tx, taskId);
}
