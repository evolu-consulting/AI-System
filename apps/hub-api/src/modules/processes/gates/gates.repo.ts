// HUB-FR-107 · §3.4 · §10 · PF1 · repo cổng kiểm: đọc/khoá task + run, đóng task (first-wins ở `core.closeTask`), đóng
// các task còn mở, ghi `passed_by`/`feedback`/`redo_sections`, persist máy trạng thái, huỷ `hub.runs` stage đang chạy.
// Chạy trong tx `withHubScope(system)` của service; mọi câu lọc `tenant_id` tường minh (RLS T là lưới). Không log nội dung.
import type { DecisionReason, TaskKind, TaskResult, TaskStatus } from "@ai/contracts/chat";
import { JOB_CANCEL_CHANNEL, type JobCancelPayload } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { runErrorText } from "../../runs/run-errors";
import type { RunState } from "../core/process-state.rules";

export type GateTask = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  stage_run_id: string;
  stage_idx: number;
  kind: TaskKind;
  status: TaskStatus;
  assignee_group_id: string | null;
  reason: DecisionReason | null;
};

/** Task + stage_idx (không khoá — service khoá `process_runs` FOR UPDATE sau). null = không thấy (RLS/tenant). */
export async function loadTask(tx: Tx, taskId: string): Promise<GateTask | null> {
  const [r] = await tx.execute<GateTask>(sql`
    select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, s.stage_idx, t.kind, t.status,
      t.assignee_group_id, t.reason
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    where t.id = ${taskId}`);
  return r ?? null;
}

/** Task `decision` đang mở của run (mở gần nhất). */
export async function openDecisionTask(
  tx: Tx,
  runId: string,
  tenantId: string,
): Promise<GateTask | null> {
  const [r] = await tx.execute<GateTask>(sql`
    select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, s.stage_idx, t.kind, t.status,
      t.assignee_group_id, t.reason
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.kind = 'decision'
      and t.status = 'open' order by t.created_at desc limit 1`);
  return r ?? null;
}

/** User id assignee của task (loại group). */
export async function assigneeUserIds(
  tx: Tx,
  taskId: string,
  tenantId: string,
): Promise<Set<string>> {
  const rows = await tx.execute<{ user_id: string }>(sql`
    select user_id from hub.review_task_assignees
    where task_id = ${taskId} and tenant_id = ${tenantId} and user_id is not null`);
  return new Set(rows.map((r) => r.user_id));
}

/** U5/T8 · phòng nguồn theo NGƯỜI thao tác (`runAccess`/`canReadThread`). Không từ phòng ⇒ "none". */
export async function originRoomOf(
  tx: Tx,
  originKind: string,
  roomId: string | null,
  userId: string,
): Promise<"none" | "deleted" | "member" | "outside"> {
  if (originKind !== "room" || !roomId) return "none";
  const [rm] = await tx.execute<{ deleted_at: string | null }>(sql`select deleted_at
    from hub.rooms where id = ${roomId}`);
  if (!rm || rm.deleted_at !== null) return "deleted";
  const [m] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.room_members
    where room_id = ${roomId} and user_id = ${userId} and left_at is null limit 1`);
  return m ? "member" : "outside";
}

export type ActorRef = { id: string; display_name: string };
/** Tên người thao tác (tin thread). Không thấy ⇒ dùng id. */
export async function actorRef(tx: Tx, userId: string, tenantId: string): Promise<ActorRef> {
  const [r] = await tx.execute<{ id: string; display_name: string | null; username: string }>(sql`
    select id, display_name, username from admin.users where id = ${userId} and tenant_id = ${tenantId}`);
  return { id: userId, display_name: r?.display_name || r?.username || userId };
}

/** T8 · người thao tác không là thành viên hiện tại của phòng nguồn (meta `outside` tin thread). roomId null ⇒ false. */
export async function isOutside(tx: Tx, roomId: string | null, userId: string): Promise<boolean> {
  if (!roomId) return false;
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.room_members
    where room_id = ${roomId} and user_id = ${userId} and left_at is null limit 1`);
  return r === undefined;
}

/** Đóng mọi task còn mở của run (trừ `exceptId`) với `result` (stage bị thay / huỷ / hết hạn). */
export async function closeOpenTasks(
  tx: Tx,
  p: { runId: string; tenantId: string; result: TaskResult; exceptId: string | null; now: Date },
): Promise<void> {
  await tx.execute(sql`update hub.review_tasks set status = 'closed', result = ${p.result},
      decided_at = ${p.now.toISOString()}::timestamptz
    where process_run_id = ${p.runId} and tenant_id = ${p.tenantId} and status = 'open'
      and (${p.exceptId}::uuid is null or id <> ${p.exceptId}::uuid)`);
}

/** Đạt: ghi người duyệt + thời điểm trên stage (view `passed_by`, D4 real_action đọc). */
export async function setStagePassed(
  tx: Tx,
  stageRunId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await tx.execute(sql`update hub.stage_runs set passed_by = ${userId},
    passed_at = ${now.toISOString()}::timestamptz, updated_at = now() where id = ${stageRunId}`);
}

/** Chưa đạt / làm lại chọn lọc: góp ý + mục cần sửa (nguồn cho `redoMembers`, team-exec attempt>1). */
export async function writeRedo(
  tx: Tx,
  stageRunId: string,
  feedback: string | null,
  sections: readonly string[] | null,
): Promise<void> {
  const arr =
    sections && sections.length > 0
      ? sql`array[${sql.join(
          sections.map((s) => sql`${s}`),
          sql`, `,
        )}]::text[]`
      : sql`null`;
  await tx.execute(sql`update hub.stage_runs set feedback = ${feedback ?? null}, redo_sections = ${arr},
    updated_at = now() where id = ${stageRunId}`);
}

/** Máy trạng thái: process_runs + stage_runs theo `next` (như team-runner.persistState, không output). */
export async function persist(
  tx: Tx,
  c: { runId: string; stageRunId: string; idx: number; next: RunState },
): Promise<void> {
  const n = c.next;
  const finished = n.status === "done" || n.status === "cancelled" || n.status === "expired";
  await tx.execute(sql`update hub.process_runs set status = ${n.status}, current_stage_idx = ${n.stageIdx},
      updated_at = now(), finished_at = ${finished ? sql`now()` : sql`finished_at`} where id = ${c.runId}`);
  if (n.stageIdx === c.idx)
    await tx.execute(sql`update hub.stage_runs set status = ${n.stage.status}, attempt = ${n.stage.attempt},
        attempt_limit = ${n.stage.attemptLimit}, asks_count = ${n.stage.asksCount}, ask_limit = ${n.stage.askLimit},
        finished_at = ${finished ? sql`now()` : sql`finished_at`}, updated_at = now() where id = ${c.stageRunId}`);
  else {
    await tx.execute(sql`update hub.stage_runs set status = 'done', finished_at = now(), updated_at = now()
      where id = ${c.stageRunId}`);
    await tx.execute(sql`update hub.stage_runs set status = 'queued', updated_at = now()
      where process_run_id = ${c.runId} and stage_idx = ${n.stageIdx}`);
  }
}

/** Đặt trạng thái kết thúc cho run (huỷ): status + finished_at. */
export async function setRunStatus(
  tx: Tx,
  runId: string,
  status: "cancelled",
  now: Date,
): Promise<void> {
  await tx.execute(sql`update hub.process_runs set status = ${status},
    finished_at = ${now.toISOString()}::timestamptz, updated_at = now() where id = ${runId}`);
}

/** Huỷ: mọi stage chưa kết thúc ⇒ `cancelled` (như sweeper `endRun`). */
export async function cancelStages(tx: Tx, runId: string, tenantId: string): Promise<void> {
  await tx.execute(sql`update hub.stage_runs set status = 'cancelled', updated_at = now()
    where process_run_id = ${runId} and tenant_id = ${tenantId}
      and status in ('pending','queued','running','waiting_review','waiting_answer','needs_decision')`);
}

/**
 * §10 · huỷ `hub.runs` stage đang chạy của run (sau tx quy trình thì driver tìm 0 dòng running). `hub.jobs` queued ⇒
 * cancelled, running ⇒ `cancel_requested_at` + `pg_notify(job_cancel)` (Runtime dừng, nhả slot). Lọc `tenant_id` (Q7).
 */
export async function cancelStageRuns(tx: Tx, runId: string, tenantId: string): Promise<void> {
  // CHECK `runs_error_cols_ck`: error_code/message/hint cùng null hoặc cùng có ⇒ set đủ cả ba (theo locale run).
  const vi = runErrorText("CANCELLED", "vi");
  const en = runErrorText("CANCELLED", "en");
  const runs = await tx.execute<{ id: string }>(sql`update hub.runs
    set status = 'cancelled', error_code = 'CANCELLED',
      error_message = case when locale = 'en' then ${en.message} else ${vi.message} end,
      error_hint = case when locale = 'en' then ${en.hint} else ${vi.hint} end,
      finished_at = now(), owner = null, lease_until = null
    where process_run_id = ${runId} and tenant_id = ${tenantId} and status = 'running' returning id`);
  if (runs.length === 0) return;
  const ids = sql.join(
    runs.map((r) => sql`${r.id}`),
    sql`, `,
  );
  await tx.execute(sql`update hub.jobs set status = 'cancelled', cancel_requested_at = now(), finished_at = now()
    where run_id in (${ids}) and tenant_id = ${tenantId} and status = 'queued'`);
  const running = await tx.execute<{ id: string; run_id: string }>(sql`update hub.jobs
    set cancel_requested_at = now() where run_id in (${ids}) and tenant_id = ${tenantId}
      and status = 'running' and cancel_requested_at is null returning id, run_id`);
  for (const j of running) {
    const note: JobCancelPayload = { v: 1, job_id: j.id, run_id: j.run_id };
    await tx.execute(sql`select pg_notify(${JOB_CANCEL_CHANNEL}, ${JSON.stringify(note)})`);
  }
}
