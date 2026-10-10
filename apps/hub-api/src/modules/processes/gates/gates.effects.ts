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
import * as core from "../core/core.repo";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import type { RunState } from "../core/process-state.rules";
import { enqueueThread } from "../core/thread";
import { stageRowOf, toDecision } from "../runs/team-runner";
import * as g from "./gates.repo";

export type Locked = core.RunHead;
export type Stage = Awaited<ReturnType<typeof stageRowOf>>;
export type SnapStage = { after: { kind: "review"; group_id: string | null } | { kind: "auto" } };
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
export const needsKick = (e: readonly string[]): boolean =>
  e.includes("queue_stage") || e.includes("queue_next_stage");

export type StateIn = {
  run: Locked;
  s: Stage;
  def: SnapStage | undefined;
  idx: number;
  reason: DecisionReason | null;
};
export function buildState(p: StateIn): RunState {
  const { run, s, def, idx } = p;
  return {
    status: run.status,
    stageIdx: idx,
    stageCount: snapOf(run).stages.length,
    stage: {
      status: (s?.status ?? "running") as RunState["stage"]["status"],
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

const isOutside = (gx: Gx, run: Locked, userId: string) =>
  g.originRoomOf(gx.tx, run.originKind, run.originRoomId, userId).then((r) => r === "outside");

type ResultMeta = {
  run: Locked;
  idx: number;
  taskId: string;
  kind: "review" | "decision";
  result: TaskResult;
  ref: g.ActorRef;
  feedback?: string;
  sections?: string[];
};
/** Tin thread `task_result` (Đạt/Chưa đạt/quyết định) — T8 `outside` theo người thao tác. */
async function threadResult(gx: Gx, m: ResultMeta): Promise<void> {
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
  });
}

/** Đạt → advance (passed_by + đóng task khác + persist); Chưa đạt → redo (feedback/redo_sections) hoặc redo_limit→decide. */
export async function reviewEffects(
  gx: Gx,
  e: Eff,
  task: g.GateTask,
  b: ReviewDecisionRequest,
): Promise<UserEvent[]> {
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
  const p = { runId: run.id, stageRunId: task.stage_run_id, idx, next };
  if (b.result === "pass") {
    await g.setStagePassed(tx, task.stage_run_id, ref.id, d.now());
    const o = {
      runId: run.id,
      tenantId: run.tenantId,
      result: "superseded" as const,
      exceptId: task.id,
      now: d.now(),
    };
    await g.closeOpenTasks(tx, o);
    await g.persist(tx, p);
    if (effects.includes("finish_run")) events.push(...(await finish(gx, run, ref, "done")));
  } else if (next.status === "needs_decision") {
    const dec = {
      runId: run.id,
      tenantId: run.tenantId,
      idx,
      stageRunId: task.stage_run_id,
      reason: "redo_limit" as const,
    };
    events.push(...(await toDecision(d, tx, dec)));
  } else {
    await g.writeRedo(tx, task.stage_run_id, b.feedback ?? null, b.sections ?? null);
    await g.persist(tx, p);
  }
  return events;
}

/** add_attempt/use_current/cancel: đóng task decision + task_result, rồi redo/advance/openReview/finish hoặc huỷ. */
export async function decideEffects(
  gx: Gx,
  e: Eff,
  option: DecideProcessRunRequest["option"],
  dtask: g.GateTask | null,
): Promise<UserEvent[]> {
  const { d, tx } = gx;
  const { run, idx, next, effects, ref } = e;
  const sid = dtask?.stage_run_id ?? "";
  const events: UserEvent[] = [];
  if (dtask) {
    await core.closeTask(tx, dtask.id, {
      result: option as TaskResult,
      at: d.now(),
      decidedBy: ref.id,
    });
    await threadResult(gx, {
      run,
      idx,
      taskId: dtask.id,
      kind: "decision",
      result: option as TaskResult,
      ref,
    });
    events.push(...(await d.notifier.taskClosed(tx, dtask.id)));
  }
  if (option === "cancel" || next.status === "cancelled")
    return [...events, ...(await cancelEnd(gx, { run, idx, ref }, dtask?.id ?? null))];
  if (effects.includes("close_open_tasks")) {
    await g.setStagePassed(tx, sid, ref.id, d.now());
    await g.closeOpenTasks(tx, {
      runId: run.id,
      tenantId: run.tenantId,
      result: "superseded",
      exceptId: dtask?.id ?? null,
      now: d.now(),
    });
  }
  await g.persist(tx, { runId: run.id, stageRunId: sid, idx, next });
  if (effects.includes("open_review")) events.push(...(await openReview(gx, run, sid, idx)));
  if (effects.includes("finish_run")) events.push(...(await finish(gx, run, ref, "done")));
  return events;
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
