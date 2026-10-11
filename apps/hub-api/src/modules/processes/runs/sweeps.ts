// HUB-FR-106 · D10 · D11 · AC-H32 · BR-26 · PF1 · vòng quét (plan §3.1, §4, §10): stage `queued` mồ côi (kick lại),
// đối chiếu `interrupted` (stage running mà `hub.runs` kết thúc > 60 s), hết hạn 7 ngày (`expired`). Scope `system`
// (không một người xem); lọc `tenant_id` tường minh. Sự kiện + tin thread phát/đăng SAU COMMIT.
import {
  DECISION_OPTIONS,
  type DecisionOption,
  PROCESS_RUN_ACTIVE,
  type ProcessRunStatus,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import type { SweepResult } from "../core/handles";
import type { ProcessDeps } from "../core/ports";
import { decisionAssignees } from "../core/task.rules";
import { enqueueThread } from "../core/thread";
import { toDecision as trToDecision } from "./team-runner";

/** PB-R05 · job resolve mồ côi/quá hạn (lease + chờ queued) — khớp seam now. */
const RESOLVE_STALE_MS = 240_000;

const SYSTEM = { kind: "system" } as const;
const BATCH = 100;
const INTERRUPT_GRACE_MS = 60_000;

const activeList = sql`(${sql.join(
  PROCESS_RUN_ACTIVE.map((s) => sql`${s}`),
  sql`, `,
)})`;

type SnapStage = { after: { kind: "review"; group_id: string | null } | { kind: "auto" } };

/** Mọi vòng của một lượt (plan-contract §7.1 `sweepOnce`). */
export async function sweepOnce(d: ProcessDeps): Promise<SweepResult> {
  const expired = await expireRuns(d);
  const interrupted = await reconcileRuns(d);
  await resolveTimeouts(d);
  const queued = await requeueOrphans(d);
  return { queued, interrupted, expired };
}

/** PB-R05 · run chờ resolve mà không còn job resolve còn sống (failed/timeout/orphan) ⇒ needs_decision source_unresolvable. */
async function resolveTimeouts(d: ProcessDeps): Promise<number> {
  const cutoff = new Date(d.now().getTime() - RESOLVE_STALE_MS).toISOString();
  const rows = await withHubScope(d.db, SYSTEM, (tx) =>
    tx.execute<{ id: string }>(sql`select r.id from hub.process_runs r
      where r.status = 'running' and r.pinned_sources is null
        and coalesce(jsonb_array_length(r.snapshot->'sources'), 0) > 0
        and not exists (select 1 from hub.jobs j
          where j.type = 'source.resolve' and j.payload->>'process_run_id' = r.id::text
            and ((j.status = 'queued' and j.created_at > ${cutoff}::timestamptz)
              or (j.status = 'running'
                and coalesce(j.heartbeat_at, j.started_at, j.created_at) > ${cutoff}::timestamptz)))
      order by r.updated_at limit ${BATCH}`),
  );
  let n = 0;
  for (const { id } of rows) if (await markUnresolvable(d, id)) n++;
  return n;
}

/** needs_decision source_unresolvable cho run (khoá run; đã ghim / không còn running ⇒ bỏ). */
async function markUnresolvable(d: ProcessDeps, runId: string): Promise<boolean> {
  const events = await withHubScope(d.db, SYSTEM, async (tx): Promise<UserEvent[] | null> => {
    const h = await head(tx, runId);
    if (!h) return null;
    const run = await core.lockRun(tx, h.tenant_id, runId);
    if (run?.status !== "running") return null;
    const [cur] = await tx.execute<{ pinned: unknown }>(
      sql`select pinned_sources as pinned from hub.process_runs where id = ${runId}`,
    );
    if (Array.isArray(cur?.pinned)) return null;
    const idx = Number(run.currentStageIdx);
    const stage = await stageRow(tx, runId, idx);
    if (!stage) return null;
    return trToDecision(d, tx, {
      runId,
      tenantId: h.tenant_id,
      idx,
      stageRunId: stage.id,
      reason: "source_unresolvable",
    });
  });
  if (events === null) return false;
  await publishUserEvents(d.redis, events, d.log);
  await d.postThread(runId).catch(() => {});
  return true;
}

/** BR-26 · run hết hạn (`expires_at ≤ now`): đóng task `expired`, `run_end`, không tự duyệt. */
async function expireRuns(d: ProcessDeps): Promise<number> {
  const now = d.now();
  const rows = await withHubScope(d.db, SYSTEM, (tx) =>
    tx.execute<{ id: string }>(sql`select id from hub.process_runs
      where status in ${activeList} and expires_at <= ${now.toISOString()}::timestamptz
      order by expires_at limit ${BATCH}`),
  );
  let n = 0;
  for (const { id } of rows) if (await endRun(d, id, "expired", now)) n++;
  return n;
}

/** Đóng một run về trạng thái kết thúc (`expired`): tx system, tin thread + sự kiện sau COMMIT. */
async function endRun(
  d: ProcessDeps,
  runId: string,
  status: "expired",
  now: Date,
): Promise<boolean> {
  const events = await withHubScope(d.db, SYSTEM, async (tx): Promise<UserEvent[] | null> => {
    const run = await core.lockRun(tx, tenantOf(await head(tx, runId)), runId);
    if (!run || !isActive(run.status as ProcessRunStatus)) return null;
    await tx.execute(sql`update hub.process_runs set status = ${status}, finished_at = ${now.toISOString()}::timestamptz,
        updated_at = ${now.toISOString()}::timestamptz where id = ${runId}`);
    await tx.execute(sql`update hub.stage_runs set status = 'cancelled', updated_at = ${now.toISOString()}::timestamptz
      where process_run_id = ${runId} and status in ('pending','queued','running','waiting_review','waiting_answer','needs_decision')`);
    await tx.execute(sql`update hub.review_tasks set status = 'closed', result = ${status},
        decided_at = ${now.toISOString()}::timestamptz where process_run_id = ${runId} and status = 'open'`);
    await enqueueThread(tx, {
      runId,
      roomId: "",
      kind: "run_end",
      process_run_id: runId,
      status,
      actor: null,
    });
    return d.notifier.runFinished(tx, runId);
  });
  if (events === null) return false;
  await publishUserEvents(d.redis, events, d.log);
  await d.postThread(runId).catch(() => {});
  return true;
}

/** D11 · stage `running` mà `hub.runs` kết thúc > 60 s không có kết quả ⇒ needs_decision{interrupted}. */
async function reconcileRuns(d: ProcessDeps): Promise<number> {
  const now = d.now();
  const cutoff = new Date(now.getTime() - INTERRUPT_GRACE_MS);
  const rows = await withHubScope(d.db, SYSTEM, (tx) =>
    tx.execute<{ process_run_id: string }>(sql`
      select s.process_run_id from hub.stage_runs s
      join hub.runs r on r.id = s.current_run_id
      where s.status = 'running' and r.status <> 'running' and r.finished_at < ${cutoff.toISOString()}::timestamptz
      order by s.updated_at limit ${BATCH}`),
  );
  let n = 0;
  for (const { process_run_id } of rows)
    if (await toDecision(d, process_run_id, "interrupted", now)) n++;
  return n;
}

/** needs_decision với lý do; mở task `decision` (người bắt đầu; group chỉ khi `redo_limit`). */
async function toDecision(
  d: ProcessDeps,
  runId: string,
  reason: "interrupted",
  now: Date,
): Promise<boolean> {
  const out = await withHubScope(d.db, SYSTEM, async (tx): Promise<UserEvent[] | null> => {
    const h = await head(tx, runId);
    if (!h) return null;
    const run = await core.lockRun(tx, h.tenant_id, runId);
    if (run?.status !== "running") return null;
    const idx = Number(run.currentStageIdx);
    const stage = await stageRow(tx, runId, idx);
    if (stage?.status !== "running") return null;
    const options = decisionOptions(stage.current_output_id !== null);
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
      remindAt: new Date(now.getTime() + 86_400_000),
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
  });
  if (out === null) return false;
  await publishUserEvents(d.redis, out, d.log);
  await d.postThread(runId).catch(() => {});
  return true;
}

/** K4 · stage `queued` mồ côi (chưa có `hub.runs` đang chạy) ⇒ `kick` lại (idempotent ở launcher). */
async function requeueOrphans(d: ProcessDeps): Promise<number> {
  const rows = await withHubScope(d.db, SYSTEM, (tx) =>
    tx.execute<{ process_run_id: string }>(sql`
      select s.process_run_id from hub.stage_runs s
      where s.status = 'queued'
        and not exists (select 1 from hub.runs r where r.stage_run_id = s.id and r.status = 'running')
      order by s.updated_at limit ${BATCH}`),
  );
  let n = 0;
  for (const { process_run_id } of rows) {
    try {
      await d.launcher.kick(process_run_id);
      n++;
    } catch (err) {
      d.log.warn("process-sweep-kick-failed", { run_id: process_run_id, ...safeErrorFields(err) });
    }
  }
  return n;
}

// ── trợ giúp đọc ──
type Head = { tenant_id: string; snapshot: { stages: SnapStage[] } };
async function head(tx: Tx, runId: string): Promise<(Head & { id: string }) | null> {
  const [r] = await tx.execute<Head & { id: string }>(sql`select id, tenant_id, snapshot
    from hub.process_runs where id = ${runId}`);
  return r ?? null;
}
const tenantOf = (h: { tenant_id: string } | null): string => h?.tenant_id ?? "";

async function stageRow(
  tx: Tx,
  runId: string,
  idx: number,
): Promise<{ id: string; status: string; current_output_id: string | null } | null> {
  const [s] = await tx.execute<{
    id: string;
    status: string;
    current_output_id: string | null;
  }>(sql`
    select id, status, current_output_id from hub.stage_runs
    where process_run_id = ${runId} and stage_idx = ${idx}`);
  return s ?? null;
}

const reviewGroupOf = (h: Head, idx: number): string | null => {
  const after = h.snapshot.stages[idx]?.after;
  return after?.kind === "review" ? after.group_id : null;
};

const isActive = (s: ProcessRunStatus): boolean =>
  (PROCESS_RUN_ACTIVE as readonly string[]).includes(s);

const decisionOptions = (hasOutput: boolean): DecisionOption[] =>
  DECISION_OPTIONS.filter((o) => o !== "use_current" || hasOutput);
