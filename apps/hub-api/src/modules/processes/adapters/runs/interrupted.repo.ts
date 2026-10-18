// HUB-FR-106 · D10 · D11 · AC-H32 · T7s · adapter của use case `sweep-interrupted`: bọc SQL cũ của `sweeps.toDecision` —
// khoá run, kiểm lại stage còn `running`, chuyển run + stage sang `needs_decision`, mở task `decision`, xếp tin thread,
// báo `notifier.taskOpened` (một tx scope `system`, tenant lấy từ hàng run). Phát sự kiện/đăng thread SAU COMMIT là việc
// của use case (qua port `publish`/`postThread`).
import { PROCESS_RUN_ACTIVE, type ProcessRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { publishUserEvents, type UserEvent } from "../../../../lib/user-stream";
import type { InterruptedPorts } from "../../application/runs/sweep-interrupted.usecase";
import * as core from "../../core/core.repo";
import type { ProcessDeps } from "../../core/ports";
import { decisionAssignees, decisionOptionsFor } from "../../core/task.rules";
import { enqueueThread } from "../../core/thread";
import type { DecisionReason } from "../../domain/types";

type SnapStage = {
  step?: number;
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
};
export type Head = { tenant_id: string; snapshot: { stages: SnapStage[] } };

const SYSTEM = { kind: "system" } as const;
const DAY_MS = 86_400_000;

export async function head(tx: Tx, runId: string): Promise<(Head & { id: string }) | null> {
  const [r] = await tx.execute<Head & { id: string }>(sql`select id, tenant_id, snapshot
    from hub.process_runs where id = ${runId}`);
  return r ?? null;
}

type StageById = {
  id: string;
  stage_idx: number;
  status: string;
  current_output_id: string | null;
};
async function stageById(tx: Tx, runId: string, id: string): Promise<StageById | null> {
  const [s] = await tx.execute<StageById>(sql`select id, stage_idx, status, current_output_id
    from hub.stage_runs where id = ${id} and process_run_id = ${runId}`);
  return s ?? null;
}

const reviewGroupOf = (h: Head, idx: number): string | null => {
  const after = h.snapshot.stages[idx]?.after;
  return after?.kind === "review" ? after.group_id : null;
};

const isActive = (s: ProcessRunStatus): boolean =>
  (PROCESS_RUN_ACTIVE as readonly string[]).includes(s);

type OpenArgs = { runId: string; stageRunId: string; reason: DecisionReason };

/** Chuyển stage `running` sang `needs_decision{reason}` + mở task `decision` (người bắt đầu; group chỉ khi `redo_limit`). */
async function openDecisionTx(
  d: ProcessDeps,
  tx: Tx,
  p: OpenArgs,
  now: Date,
): Promise<UserEvent[] | null> {
  const { runId, reason } = p;
  const h = await head(tx, runId);
  if (!h) return null;
  const run = await core.lockRun(tx, h.tenant_id, runId);
  if (!run || !isActive(run.status as ProcessRunStatus)) return null;
  // D3 · idx từ chính hàng stage (không từ `current_stage_idx`); đọc lại SAU khoá (đua với job xong / huỷ).
  const stage = await stageById(tx, runId, p.stageRunId);
  if (stage?.status !== "running") return null;
  const idx = Number(stage.stage_idx);
  const options = decisionOptionsFor(stage.current_output_id !== null, reason);
  await tx.execute(sql`update hub.process_runs set status = 'needs_decision',
      decision = ${JSON.stringify({ reason, stage_idx: idx, options, at: now.toISOString() })}::jsonb,
      updated_at = ${now.toISOString()}::timestamptz where id = ${runId}`);
  await tx.execute(sql`update hub.stage_runs set status = 'needs_decision',
      updated_at = ${now.toISOString()}::timestamptz where id = ${stage.id}`);
  const assignees = decisionAssignees(reason, run.startedBy, reviewGroupOf(h, idx));
  const taskId = await core.insertTask(tx, {
    tenantId: h.tenant_id,
    runId,
    stageRunId: stage.id,
    kind: "decision",
    remindAt: new Date(now.getTime() + DAY_MS),
    reason,
    userIds: assignees.userIds,
    groupId: assignees.groupId,
  });
  await enqueueThread(tx, {
    runId,
    roomId: "",
    kind: "decision",
    process_run_id: runId,
    stage_idx: idx,
    task_id: taskId,
    reason,
    options,
  });
  return d.notifier.taskOpened(tx, taskId);
}

/** Dựng các cổng của use case từ deps nền: SQL bọc ở trên, phát sự kiện Redis + đăng thread. */
export function interruptedPorts(d: ProcessDeps): InterruptedPorts<UserEvent[]> {
  return {
    open: (p, now) => withHubScope(d.db, SYSTEM, (tx) => openDecisionTx(d, tx, p, now)),
    publish: (events) => publishUserEvents(d.redis, events, d.log),
    postThread: (runId) => d.postThread(runId),
  };
}
