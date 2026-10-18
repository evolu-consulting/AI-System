// HUB-FR-107 · §3.4 · §10 · PF1 · repo cổng kiểm: đọc/khoá task + run, đóng task (first-wins ở `core.closeTask`), đóng
// các task còn mở, ghi `passed_by`/`feedback`/`redo_sections`, huỷ `hub.runs` stage đang chạy (persist: `runs/step-persist`).
// Chạy trong tx `withHubScope(user)` người thao tác của GateService; mọi câu lọc `tenant_id` tường minh (RLS T là lưới). Không log nội dung.
import type {
  DecisionReason,
  StageRunStatus,
  TaskKind,
  TaskResult,
  TaskStatus,
} from "@ai/contracts/chat";
import { JOB_CANCEL_CHANNEL, type JobCancelPayload } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { runErrorText } from "../../runs/run-errors";

export type GateTask = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  stage_run_id: string;
  stage_idx: number;
  kind: TaskKind;
  status: TaskStatus;
  assignee_group_id: string | null;
  /** PD-R21 · Group chuyển cấp (assignee `via='escalated'`) — thành viên cũng quyết được. */
  escalated_group_id: string | null;
  reason: DecisionReason | null;
};

/** PD-R21 · Group `via='escalated'` của task (khớp `tenant_id` task; index `review_task_assignees` theo task). */
const escalatedGroup = sql`(select a.group_id from hub.review_task_assignees a
  where a.task_id = t.id and a.tenant_id = t.tenant_id and a.via = 'escalated' and a.group_id is not null
  limit 1) as escalated_group_id`;

/** Task + stage_idx (không khoá — service khoá `process_runs` FOR UPDATE sau). null = không thấy (RLS/tenant). */
export async function loadTask(tx: Tx, taskId: string): Promise<GateTask | null> {
  const [r] = await tx.execute<GateTask>(sql`
    select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, s.stage_idx, t.kind, t.status,
      t.assignee_group_id, ${escalatedGroup}, t.reason
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    where t.id = ${taskId}`);
  return r ?? null;
}

/** Task `decision` đang mở của run: `stageIdx` có ⇒ của stage đó (P-b2 D9); vắng ⇒ mở gần nhất. */
export async function openDecisionTask(
  tx: Tx,
  runId: string,
  tenantId: string,
  stageIdx?: number,
): Promise<GateTask | null> {
  const byStage = stageIdx === undefined ? sql`` : sql` and s.stage_idx = ${stageIdx}`;
  const [r] = await tx.execute<GateTask>(sql`
    select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, s.stage_idx, t.kind, t.status,
      t.assignee_group_id, ${escalatedGroup}, t.reason
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.kind = 'decision'
      and t.status = 'open'${byStage} order by t.created_at desc limit 1`);
  return r ?? null;
}

/** P-b2 D9 · decision mở của run (mỗi stage một) cho `pickDecisionStage`; ≤ 10 hàng (≤ 10 stage). */
export async function openDecisions(
  tx: Tx,
  runId: string,
  tenantId: string,
): Promise<{ stageIdx: number; createdAt: string; reason: DecisionReason | null }[]> {
  const rows = await tx.execute<{
    stage_idx: number;
    created_at: string | Date;
    reason: DecisionReason | null;
  }>(sql`
    select s.stage_idx, t.created_at, t.reason from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.kind = 'decision'
      and t.status = 'open' order by t.created_at asc limit 20`);
  return rows.map((r) => ({
    stageIdx: Number(r.stage_idx),
    createdAt: new Date(r.created_at).toISOString(),
    reason: r.reason,
  }));
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

/**
 * Đóng task còn mở của run (trừ `exceptId`) với `result` (stage bị thay / huỷ / hết hạn). P-b2 D6 · `stageRunId` có ⇒
 * chỉ task của stage đó (Đạt / `use_current` không `superseded` thẻ của stage song song).
 */
export async function closeOpenTasks(
  tx: Tx,
  p: {
    runId: string;
    tenantId: string;
    result: TaskResult;
    exceptId: string | null;
    now: Date;
    stageRunId?: string;
  },
): Promise<void> {
  const byStage = p.stageRunId ? sql` and stage_run_id = ${p.stageRunId}` : sql``;
  await tx.execute(sql`update hub.review_tasks set status = 'closed', result = ${p.result},
      decided_at = ${p.now.toISOString()}::timestamptz
    where process_run_id = ${p.runId} and tenant_id = ${p.tenantId} and status = 'open'
      and (${p.exceptId}::uuid is null or id <> ${p.exceptId}::uuid)${byStage}`);
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
      and status in ('pending','queued','running','waiting_review','waiting_answer','needs_decision',
        'waiting_timer')`);
}

/**
 * §10 · huỷ `hub.runs` stage đang chạy của run (sau tx quy trình thì driver tìm 0 dòng running). `hub.jobs` queued ⇒
 * cancelled, running ⇒ `cancel_requested_at` + `pg_notify(job_cancel)` (Runtime dừng, nhả slot). Lọc `tenant_id` (Q7).
 */
export async function cancelStageRuns(tx: Tx, runId: string, tenantId: string): Promise<void> {
  await cancelRunsWhere(tx, tenantId, sql`process_run_id = ${runId}`);
}

/**
 * P-b2 · huỷ đúng các `hub.runs` (stage đơn theo id, member theo `team_run_id`) của stage bị quay lại — gọi SAU COMMIT ở scope
 * `system` (RLS `runs_hub_rw` chỉ cho chủ run thấy hàng ⇒ người duyệt khác người bắt đầu không huỷ được trong tx của mình).
 * Lọc theo id đã thu trong tx (không theo stage) ⇒ không huỷ nhầm run mới do `kick` vừa tạo.
 */
export async function cancelRunsByIds(
  tx: Tx,
  tenantId: string,
  p: { runIds: readonly string[]; teamRunIds: readonly string[] },
): Promise<void> {
  if (p.runIds.length === 0 && p.teamRunIds.length === 0) return;
  const ids = `{${p.runIds.join(",")}}`;
  const teams = `{${p.teamRunIds.join(",")}}`;
  await cancelRunsWhere(
    tx,
    tenantId,
    sql`(id = any(${ids}::uuid[]) or team_run_id = any(${teams}::uuid[]))`,
  );
}

async function cancelRunsWhere(tx: Tx, tenantId: string, where: SQL): Promise<void> {
  // CHECK `runs_error_cols_ck`: error_code/message/hint cùng null hoặc cùng có ⇒ set đủ cả ba (theo locale run).
  const vi = runErrorText("CANCELLED", "vi");
  const en = runErrorText("CANCELLED", "en");
  const runs = await tx.execute<{ id: string }>(sql`update hub.runs
    set status = 'cancelled', error_code = 'CANCELLED',
      error_message = case when locale = 'en' then ${en.message} else ${vi.message} end,
      error_hint = case when locale = 'en' then ${en.hint} else ${vi.hint} end,
      finished_at = now(), owner = null, lease_until = null
    where ${where} and tenant_id = ${tenantId} and status = 'running' returning id`);
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

// ── P-b2 · quay lại bước (HUB-FR-118, plan §3.5, D7–D8) ──

/** Stage của run cho `backResetPlan` (≤ 10 hàng, index `stage_runs_run_idx_uq`). */
export async function stagesForBack(
  tx: Tx,
  runId: string,
  tenantId: string,
): Promise<{ id: string; idx: number; status: StageRunStatus; round: number }[]> {
  const rows = await tx.execute<{
    id: string;
    stage_idx: number;
    status: StageRunStatus;
    round: number;
  }>(
    sql`select id, stage_idx, status, round from hub.stage_runs
      where process_run_id = ${runId} and tenant_id = ${tenantId} order by stage_idx`,
  );
  return rows.map((r) => ({
    id: r.id,
    idx: Number(r.stage_idx),
    status: r.status,
    round: Number(r.round),
  }));
}

/** D7 · reset một stage (gọi theo idx tăng dần — plan §7). */
export async function resetStage(
  tx: Tx,
  stageRunId: string,
  r: { status: "queued" | "pending"; round: number; feedback: string | null; tenantId: string },
): Promise<void> {
  await tx.execute(sql`update hub.stage_runs set status = ${r.status}, round = ${r.round},
      attempt = 1, attempt_limit = 4, asks_count = 0, ask_limit = 3, template_failures = 0,
      current_run_id = null, current_output_id = null, passed_by = null, passed_at = null,
      back_to_step = null, redo_sections = null, feedback = ${r.feedback}, finished_at = null,
      updated_at = now()
    where id = ${stageRunId} and tenant_id = ${r.tenantId}`);
}

/** `team_runs` đang chạy / chờ trả lời của các stage bị reset ⇒ `cancelled` (BK-09). */
export async function cancelTeamRuns(
  tx: Tx,
  runId: string,
  tenantId: string,
  stageRunIds: readonly string[],
): Promise<string[]> {
  if (stageRunIds.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`update hub.team_runs set status = 'cancelled',
      stop_reason = 'cancelled', finished_at = now()
    where process_run_id = ${runId} and tenant_id = ${tenantId}
      and status in ('running', 'waiting_answer')
      and stage_run_id = any(${`{${stageRunIds.join(",")}}`}::uuid[]) returning id`);
  return rows.map((r) => r.id);
}

/** `stage_runs.current_run_id` (≠ null) của các stage — `hub.runs` cần huỷ sau COMMIT. */
export async function currentRunIds(
  tx: Tx,
  tenantId: string,
  stageRunIds: readonly string[],
): Promise<string[]> {
  if (stageRunIds.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`select current_run_id as id from hub.stage_runs
    where id = any(${`{${stageRunIds.join(",")}}`}::uuid[]) and tenant_id = ${tenantId}
      and current_run_id is not null`);
  return rows.map((r) => r.id);
}

/** Run sau khi quay lại: bước X, vòng +1 (và `back_limit` +1 khi `add_attempt` — D8), trạng thái `running`. */
export async function setRunBack(
  tx: Tx,
  runId: string,
  p: { tenantId: string; step: number; firstIdx: number; raiseLimit: boolean },
): Promise<void> {
  const lim = p.raiseLimit ? sql`back_limit + 1` : sql`back_limit`;
  await tx.execute(sql`update hub.process_runs set current_step = ${p.step},
      current_stage_idx = ${p.firstIdx}, back_limit = ${lim}, back_rounds = back_rounds + 1,
      status = 'running', decision = null, updated_at = now()
    where id = ${runId} and tenant_id = ${p.tenantId}`);
}

export type BackEventRow = {
  tenantId: string;
  runId: string;
  taskId: string | null;
  fromStageIdx: number;
  fromStep: number;
  toStep: number;
  roundAfter: number;
  feedback: string;
  decidedBy: string;
};

/** Một hàng `process_back_events` (ghi sau `review_tasks`, trước `process_notices` — plan §7). */
export async function insertBackEvent(tx: Tx, e: BackEventRow): Promise<void> {
  await tx.execute(sql`insert into hub.process_back_events (tenant_id, process_run_id, task_id,
      from_stage_idx, from_step, to_step, round_after, feedback, decided_by)
    values (${e.tenantId}, ${e.runId}, ${e.taskId}, ${e.fromStageIdx}, ${e.fromStep}, ${e.toStep},
      ${e.roundAfter}, ${e.feedback}, ${e.decidedBy})`);
}

/** D8 · quá trần: lưu đích + góp ý trên stage nguồn (dùng lại khi `add_attempt`). */
export async function setBackPending(
  tx: Tx,
  s: { stageRunId: string; tenantId: string },
  toStep: number,
  feedback: string,
): Promise<void> {
  await tx.execute(sql`update hub.stage_runs set back_to_step = ${toStep}, feedback = ${feedback},
    updated_at = now() where id = ${s.stageRunId} and tenant_id = ${s.tenantId}`);
}

/** D8 · decision `back_limit` chọn `use_current` (stage coi như Đạt) ⇒ bỏ đích + góp ý quay lại đã lưu. */
export async function clearBackPending(
  tx: Tx,
  s: { stageRunId: string; tenantId: string },
): Promise<void> {
  await tx.execute(sql`update hub.stage_runs set back_to_step = null, feedback = null,
    updated_at = now() where id = ${s.stageRunId} and tenant_id = ${s.tenantId}`);
}

/** Đích + góp ý đã lưu của stage nguồn (decision `back_limit`). */
export async function backPendingOf(
  tx: Tx,
  s: { stageRunId: string; tenantId: string },
): Promise<{ toStep: number; feedback: string } | null> {
  const [r] = await tx.execute<{ back_to_step: number | null; feedback: string | null }>(sql`
    select back_to_step, feedback from hub.stage_runs where id = ${s.stageRunId}
      and tenant_id = ${s.tenantId}`);
  if (!r || r.back_to_step === null) return null;
  return { toStep: Number(r.back_to_step), feedback: r.feedback ?? "" };
}

/** Đặt `decision` jsonb = decision mở cũ nhất còn lại (D9, tương thích); không còn ⇒ giữ nguyên. */
export async function setDecisionJson(
  tx: Tx,
  run: { id: string; tenantId: string },
  json: string,
): Promise<void> {
  await tx.execute(sql`update hub.process_runs set decision = ${json}::jsonb, updated_at = now()
    where id = ${run.id} and tenant_id = ${run.tenantId}`);
}
