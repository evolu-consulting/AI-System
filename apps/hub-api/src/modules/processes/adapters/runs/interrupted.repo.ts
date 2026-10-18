// HUB-FR-106 · D10 · D11 · AC-H32 · T7s/T7 · adapter của use case `sweep-interrupted`: bọc SQL cũ của `sweeps.toDecision` —
// khoá run, kiểm lại stage còn `running` (lọc `tenant_id`), hỏi use case thử lại hay quyết (`decide`, repo `bindTx` của
// tx — K2: tenant từ hàng run đã khoá), rồi nếu quyết: chuyển run + stage sang `needs_decision`, mở task `decision`, xếp
// tin thread, báo `notifier.taskOpened` (một tx scope `system`). Phát sự kiện/đăng thread SAU COMMIT là việc của use case.
import { PROCESS_RUN_ACTIVE, type ProcessRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { publishUserEvents, type UserEvent } from "../../../../lib/user-stream";
import type {
  InterruptDecider,
  InterruptedPorts,
} from "../../application/runs/sweep-interrupted.usecase";
import * as core from "../../core/core.repo";
import type { ProcessDeps } from "../../core/ports";
import { enqueueThread } from "../../core/thread";
import { decisionAssignees, decisionOptionsFor } from "../../domain/tasks/decision.rules";
import type { DecisionReason } from "../../domain/types";
import { bindTx } from "../hub-uow";

type SnapStage = {
  step?: number;
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
  executor?: { kind: string };
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
  current_run_id: string | null;
};
/** T7 · plan §4.4 · lọc `tenant_id` của hàng run đã khoá (trước đây thiếu). */
async function stageById(
  tx: Tx,
  p: { runId: string; tenantId: string; id: string },
): Promise<StageById | null> {
  const [s] =
    await tx.execute<StageById>(sql`select id, stage_idx, status, current_output_id, current_run_id
    from hub.stage_runs where id = ${p.id} and process_run_id = ${p.runId} and tenant_id = ${p.tenantId}`);
  return s ?? null;
}

const reviewGroupOf = (h: Head, idx: number): string | null => {
  const after = h.snapshot.stages[idx]?.after;
  return after?.kind === "review" ? after.group_id : null;
};

const isActive = (s: ProcessRunStatus): boolean =>
  (PROCESS_RUN_ACTIVE as readonly string[]).includes(s);

type OpenArgs = { runId: string; stageRunId: string };

/**
 * Khoá run → đọc lại stage `running` → stage agent: hỏi `decide` (thử lại ⇒ `[]`, không mở quyết định); stage nhóm/Áp
 * giữ `interrupted` (nhóm thử lại ở T7b, Áp không áp — PD-R09). `null` ⇒ bỏ.
 */
async function openTx(
  d: ProcessDeps,
  tx: Tx,
  p: OpenArgs & { now: Date },
  decide: InterruptDecider,
): Promise<UserEvent[] | null> {
  const h = await head(tx, p.runId);
  if (!h) return null;
  const run = await core.lockRun(tx, h.tenant_id, p.runId);
  if (!run || !isActive(run.status as ProcessRunStatus)) return null;
  // D3 · idx từ chính hàng stage (không từ `current_stage_idx`); đọc lại SAU khoá (đua với job xong / huỷ).
  const stage = await stageById(tx, { runId: p.runId, tenantId: h.tenant_id, id: p.stageRunId });
  if (stage?.status !== "running") return null;
  const idx = Number(stage.stage_idx);
  // D4 · job `aborted`/hub run huỷ mà run quy trình còn hoạt động (đã kiểm ở trên) ⇒ lỗi tạm, qua `decide`.
  const agent = h.snapshot.stages[idx]?.executor?.kind === "agent";
  const reason = agent ? await decide(bindTx(tx, h.tenant_id).repos) : "interrupted";
  if (reason === null) return [];
  return openDecision(d, tx, { h, run, stage, idx, reason }, p.now);
}

type DecisionArgs = {
  h: Head & { id: string };
  run: { startedBy: string };
  stage: StageById;
  idx: number;
  reason: DecisionReason;
};

/** Chuyển stage sang `needs_decision{reason}` + mở task `decision` (người bắt đầu; group chỉ khi `redo_limit`). */
async function openDecision(
  d: ProcessDeps,
  tx: Tx,
  a: DecisionArgs,
  now: Date,
): Promise<UserEvent[]> {
  const { h, stage, idx, reason } = a;
  const runId = h.id;
  const options = decisionOptionsFor(stage.current_output_id !== null, reason);
  await tx.execute(sql`update hub.process_runs set status = 'needs_decision',
      decision = ${JSON.stringify({ reason, stage_idx: idx, options, at: now.toISOString() })}::jsonb,
      updated_at = ${now.toISOString()}::timestamptz where id = ${runId}`);
  await tx.execute(sql`update hub.stage_runs set status = 'needs_decision',
      updated_at = ${now.toISOString()}::timestamptz where id = ${stage.id}`);
  const assignees = decisionAssignees(reason, a.run.startedBy, reviewGroupOf(h, idx));
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
    open: (p, now, decide) =>
      withHubScope(d.db, SYSTEM, (tx) => openTx(d, tx, { ...p, now }, decide)),
    publish: (events) => publishUserEvents(d.redis, events, d.log),
    postThread: (runId) => d.postThread(runId),
  };
}
