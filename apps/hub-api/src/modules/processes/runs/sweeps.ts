// HUB-FR-106 · D10 · D11 · AC-H32 · BR-26 · PF1 · vòng quét (plan §3.1, §4, §10): stage `queued` mồ côi (kick lại),
// đối chiếu `interrupted` (stage running mà `hub.runs` kết thúc > 60 s), hết hạn 7 ngày (`expired`). Scope `system`
// (không một người xem); lọc `tenant_id` tường minh. Sự kiện + tin thread phát/đăng SAU COMMIT.
import { PROCESS_RUN_ACTIVE, type ProcessRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { startLoop } from "../../../lib/loop";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import type { SweepResult } from "../core/handles";
import type { ProcessDeps } from "../core/ports";
import { firstIdxOfStep } from "../core/step.rules";
import { decisionAssignees, decisionOptionsFor } from "../core/task.rules";
import { enqueueThread } from "../core/thread";
import { advanceApply } from "./apply-driver";
import { expireRuns } from "./expire";
import { stepsOfSnap } from "./step-persist";
import { toDecision as trToDecision } from "./team-runner";

/** PB-R05 · job resolve mồ côi/quá hạn (lease + chờ queued) — khớp seam now. */
const RESOLVE_STALE_MS = 240_000;

const SYSTEM = { kind: "system" } as const;
const BATCH = 100;
const INTERRUPT_GRACE_MS = 60_000;

/**
 * B2 (P-c2 D3 UAT): chu kỳ vòng nền `sweepOnce` của Hub thật (mở PR stage Áp, `interrupted`, `resolveTimeouts`,
 * `requeueOrphans`). ~3 s — đủ nhanh để stage Áp tự mở PR, chậm hơn `scanDue` (một lượt quét có index) nên không ghì pool
 * như B7. `startLoop` tự chặn chồng lượt; mỗi ứng viên re-khoá hàng ⇒ an toàn khi test cũng gọi `sweepOnce` qua handle.
 */
export const PROCESS_SWEEP_EVERY_MS = 3_000;

const activeList = sql`(${sql.join(
  PROCESS_RUN_ACTIVE.map((s) => sql`${s}`),
  sql`, `,
)})`;

type SnapStage = {
  step?: number;
  after: { kind: "review"; group_id: string | null } | { kind: "auto" };
};

type StageCand = { process_run_id: string; stage_run_id: string };
type DueRow = StageCand & { interrupted: boolean; apply_ready: boolean };

/**
 * Mọi vòng của một lượt (plan-contract §7.1 `sweepOnce`).
 * P-c2 fix (regression sweep chung): MỘT lần quét `stage_runs` `running` phát hiện cả ứng viên `interrupted` lẫn stage
 * Áp (`scanDue`) trên CHUNG một kết nối của nhịp — không mở `withHubScope`/seq-scan `stage_runs` riêng cho
 * `advanceApplies` (B7 làm P1-82/P2-11 flaky do ghì pool + quét đôi khi nhiều sweep chạy song song). Phần xử lý mỗi ứng
 * viên vẫn tx riêng (toDecision / advanceApply re-khoá), chạy 0 lần khi không có việc.
 */
export async function sweepOnce(d: ProcessDeps): Promise<SweepResult> {
  const expired = await expireRuns(d);
  const now = d.now();
  const cutoff = new Date(now.getTime() - INTERRUPT_GRACE_MS);
  const due = await withHubScope(d.db, SYSTEM, (tx) => scanDue(tx, cutoff));
  let interrupted = 0;
  for (const r of due)
    if (
      r.interrupted &&
      (await toDecision(d, { runId: r.process_run_id, stageRunId: r.stage_run_id }, now))
    )
      interrupted++;
  await resolveTimeouts(d);
  // Áp: bỏ qua nếu stage đã bị `toDecision` chuyển khỏi `running` (advanceApply tự re-khoá + re-kiểm, idempotent).
  for (const r of due)
    if (r.apply_ready && !r.interrupted)
      await advanceApply(d, { runId: r.process_run_id, stageRunId: r.stage_run_id }).catch((err) =>
        d.log.warn("apply-advance-sweep-failed", {
          run_id: r.process_run_id,
          ...safeErrorFields(err),
        }),
      );
  const queued = await requeueOrphans(d);
  return { queued, interrupted, expired };
}

/**
 * B2 · vòng nền (`lib/loop.ts`) gọi `sweepOnce` mỗi `everyMs` trên instance Hub thật — song song `startAttachmentSweeper`.
 * Mount gọi khi `processLoops !== false`; `signal` abort ⇒ dừng. Lỗi một lượt chỉ log (`process-sweep-failed`).
 */
export function startProcessSweeper(
  d: ProcessDeps,
  o: { everyMs?: number; signal?: AbortSignal } = {},
): void {
  startLoop({
    name: "process-sweep",
    everyMs: o.everyMs ?? PROCESS_SWEEP_EVERY_MS,
    tick: () => sweepOnce(d),
    log: d.log,
    signal: o.signal,
  });
}

/**
 * (chỉ ĐỌC, dùng tx chung của nhịp) Một lần quét `stage_runs` `running` trả ứng viên cần xử lý, kèm cờ:
 * - `interrupted` (D11 · P-b2 §3.8): `hub.runs` của stage kết thúc > 60 s không kết quả ⇒ needs_decision{interrupted}.
 * - `apply_ready` (P-c2 · C14/C27): có job `source.apply` đã kết thúc (hoặc đã báo cáo hàng) ⇒ `advanceApply`
 *   (mở PR / "Cần người quyết"; job kết thúc mà không hàng ⇒ failed+provider_error).
 */
function scanDue(tx: Tx, cutoff: Date): Promise<DueRow[]> {
  const cut = sql`${cutoff.toISOString()}::timestamptz`;
  // Tập job Áp "đã xong" (quét `jobs`/`autofix_applies` MỘT lần, băm) ⇒ LEFT JOIN để suy `apply_ready` thay vì EXISTS
  // tương quan trong SELECT (EXISTS-trong-SELECT ép subplan quét `jobs` MỖI hàng stage ⇒ N×M khi nhiều stage `running`).
  const applyReady = sql`(select distinct j.step_id, j.tenant_id from hub.jobs j
    where j.type = 'source.apply' and (j.status not in ('queued', 'running')
      or exists (select 1 from hub.autofix_applies aa where aa.job_id = j.id and aa.tenant_id = j.tenant_id)))`;
  const interrupted = sql`(r.id is not null and r.status <> 'running' and r.finished_at < ${cut})`;
  return tx.execute<DueRow>(sql`
    select s.process_run_id, s.id as stage_run_id,
      ${interrupted} as interrupted, (ja.step_id is not null) as apply_ready
    from hub.stage_runs s
    left join hub.runs r on r.id = s.current_run_id
    left join ${applyReady} ja on ja.step_id = s.id and ja.tenant_id = s.tenant_id
    where s.status = 'running' and (${interrupted} or ja.step_id is not null)
    order by s.updated_at limit ${BATCH}`);
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
    // P-b2 §3.8 · gắn vào stage nhỏ nhất của bước hiện tại (D4).
    const idx = Math.max(0, firstIdxOfStep(stepsOfSnap(h.snapshot), Number(run.currentStep)));
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

/** needs_decision với lý do; mở task `decision` (người bắt đầu; group chỉ khi `redo_limit`). */
async function toDecision(
  d: ProcessDeps,
  p: { runId: string; stageRunId: string },
  now: Date,
): Promise<boolean> {
  const { runId } = p;
  const reason = "interrupted" as const;
  const out = await withHubScope(d.db, SYSTEM, async (tx): Promise<UserEvent[] | null> => {
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

async function stageById(
  tx: Tx,
  runId: string,
  id: string,
): Promise<{
  id: string;
  stage_idx: number;
  status: string;
  current_output_id: string | null;
} | null> {
  const [s] = await tx.execute<{
    id: string;
    stage_idx: number;
    status: string;
    current_output_id: string | null;
  }>(sql`select id, stage_idx, status, current_output_id from hub.stage_runs
    where id = ${id} and process_run_id = ${runId}`);
  return s ?? null;
}

const reviewGroupOf = (h: Head, idx: number): string | null => {
  const after = h.snapshot.stages[idx]?.after;
  return after?.kind === "review" ? after.group_id : null;
};

const isActive = (s: ProcessRunStatus): boolean =>
  (PROCESS_RUN_ACTIVE as readonly string[]).includes(s);
