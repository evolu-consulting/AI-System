// CR-121 · R-2 · SQL của trang chi tiết lượt chạy (admin) + nhật ký một bước. Mỗi hàm MỘT câu văn bản cố định (Luật 4c:
// số câu không phụ thuộc số bước/số sự kiện). Mọi câu lọc `tenant_id` tường minh; RLS T của scope `user` là lưới.
// `readDebug` đọc `hub.runs`/`hub.jobs`/`kh_stage_usage` (RLS theo chủ run) nên chạy scope `system` SAU khi service đã
// kiểm vai platform_admin + run thuộc tenant.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { TlEvent } from "../domain/runs/run-timeline.rules";
import { iso } from "./view-steps";

export type HeadRow = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  snapshot: { key?: string; name?: string; stages?: SnapStageLite[] };
  def_version: number;
  status: string;
  current_stage_idx: number;
  current_step: number;
  origin_kind: string;
  started_by: string | null;
  started_by_name: string | null;
  decision_reason: string | null;
  is_test: boolean;
  started_at: string;
  finished_at: string | null;
  /** CR-121 R-4 · bản ghi gói gắn lượt (`pack_key`/`pack_record_id`, cùng null hoặc cùng có). */
  pack_key: string | null;
  pack_record_id: string | null;
  /** CR-121 R-4 · lượt MỚI đã chạy lại lượt này (`rerun_of` = id này; unique một phần ⇒ tối đa một). */
  rerun_by: string | null;
};
export type SnapStageLite = {
  name?: string;
  step?: number;
  executor?: { kind?: string };
  after?: { kind?: string; branch?: unknown };
};

export async function readHead(tx: Tx, runId: string, tenantId: string): Promise<HeadRow | null> {
  const [r] = await tx.execute<HeadRow>(sql`
    select r.id, r.tenant_id, t.name as tenant_name, r.snapshot, r.def_version, r.status, r.current_stage_idx,
      r.current_step, r.origin_kind, r.started_by, u.display_name as started_by_name,
      r.decision->>'reason' as decision_reason, r.is_test,
      ${iso("r.started_at")} as started_at, ${iso("r.finished_at")} as finished_at,
      r.pack_key, r.pack_record_id,
      (select n.id from hub.process_runs n where n.rerun_of = r.id and n.tenant_id = r.tenant_id limit 1) as rerun_by
    from hub.process_runs r
    left join admin.users u on u.id = r.started_by and u.tenant_id = r.tenant_id
    left join admin.tenants t on t.id = r.tenant_id
    where r.id = ${runId} and r.tenant_id = ${tenantId}`);
  return r ?? null;
}

export type StageRow = {
  stage_idx: number;
  status: string;
  attempt: number;
  attempt_limit: number;
  round: number;
  retry_count: number;
  last_error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  duration_ms: number | string | null;
  exec_vi: string | null;
  exec_en: string | null;
};

/** Tên agent/nhóm tra thẳng từ snapshot trong CÙNG câu (catalog không RLS) ⇒ không thêm câu theo số bước. */
const EXEC_JOIN = sql`
  left join hub.agents ag on ag.id = case when r.snapshot->'stages'->(s.stage_idx::int)->'executor'->>'kind' = 'agent'
      then (r.snapshot->'stages'->(s.stage_idx::int)->'executor'->>'agent_id')::uuid end
  left join hub.agent_teams tm on tm.id = case when r.snapshot->'stages'->(s.stage_idx::int)->'executor'->>'kind' = 'team'
      then (r.snapshot->'stages'->(s.stage_idx::int)->'executor'->>'team_id')::uuid end`;

export async function readStages(tx: Tx, runId: string, tenantId: string): Promise<StageRow[]> {
  const rows = await tx.execute<StageRow>(sql`
    select s.stage_idx, s.status, s.attempt, s.attempt_limit, s.round, s.retry_count, s.last_error_code,
      ${iso("s.started_at")} as started_at, ${iso("s.finished_at")} as finished_at, ${iso("s.updated_at")} as updated_at,
      (extract(epoch from (s.finished_at - s.started_at)) * 1000)::bigint as duration_ms,
      coalesce(ag.name->>'vi', tm.name->>'vi') as exec_vi, coalesce(ag.name->>'en', tm.name->>'en') as exec_en
    from hub.stage_runs s
    join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
    ${EXEC_JOIN}
    where s.process_run_id = ${runId} and s.tenant_id = ${tenantId}
    order by s.stage_idx limit 50`);
  return [...rows];
}

type EventRow = {
  src: TlEvent["src"];
  at: string;
  stage_idx: number | null;
  sub: string | null;
  sub2: string | null;
  actor_id: string | null;
  actor_name: string | null;
  a: number | null;
  b: number | null;
  ref: string | null;
};

/** Sự kiện dòng thời gian: task (mở/nhắc/chuyển cấp/đóng), hẹn thử lại, quay lại, audit — MỘT câu union (≤ 200). */
export async function readEvents(tx: Tx, runId: string, tenantId: string): Promise<TlEvent[]> {
  const rows = await tx.execute<EventRow>(sql`
    select e.src, ${iso("e.at_ts")} as at, e.stage_idx, e.sub, e.sub2, e.actor_id, e.actor_name, e.a, e.b, e.ref
    from (
      select 'task_open' as src, s.stage_idx::int as stage_idx, t.kind as sub, null::text as sub2, null::uuid as actor_id,
        null::text as actor_name, null::int as a, null::int as b, null::text as ref, t.created_at as at_ts
      from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId}
      union all
      select 'task_remind', s.stage_idx::int, t.kind, null, null, null, t.remind_count::int, null, null, t.reminded_at
      from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.reminded_at is not null
      union all
      select 'task_escalate', s.stage_idx::int, t.kind, null, null, null, null, null, null, t.escalated_at
      from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.escalated_at is not null
      union all
      select 'task_close', s.stage_idx::int, t.kind, t.result, t.decided_by, u.display_name, null, null, null, t.decided_at
      from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      left join admin.users u on u.id = t.decided_by and u.tenant_id = t.tenant_id
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.status = 'closed' and t.decided_at is not null
      union all
      select 'timer_retry', s.stage_idx::int, null, null, null, null, null, null, null, tm.created_at
      from hub.process_timers tm join hub.stage_runs s on s.id = tm.stage_run_id and s.tenant_id = tm.tenant_id
      where tm.process_run_id = ${runId} and tm.tenant_id = ${tenantId} and tm.kind = 'retry'
      union all
      select 'back', b.from_stage_idx::int, null, null, b.decided_by, u.display_name, b.to_step::int, b.round_after::int, null,
        b.created_at
      from hub.process_back_events b left join admin.users u on u.id = b.decided_by and u.tenant_id = b.tenant_id
      where b.process_run_id = ${runId} and b.tenant_id = ${tenantId}
      union all
      select 'audit', (a.summary->>'stage_idx')::int, coalesce(a.summary->>'op', a.action), a.summary->>'reason',
        a.actor_id, u.display_name, (a.summary->>'rule')::int, (a.summary->>'to_step')::int, a.summary->>'rerun_of', a.at
      from hub.audit_log a left join admin.users u on u.id = a.actor_id and u.tenant_id = a.tenant_id
      where a.entity = 'process_run' and a.entity_id = ${runId} and a.tenant_id = ${tenantId}
        and a.action in ('branch', 'cancel', 'start') and (a.action <> 'start' or a.summary->>'op' is not null)
    ) e
    order by e.at_ts, e.src limit 200`);
  return rows.map((r) => ({
    src: r.src,
    at: r.at,
    stageIdx: r.stage_idx === null ? null : Number(r.stage_idx),
    sub: r.sub,
    sub2: r.sub2,
    actor: r.actor_id ? { id: r.actor_id, display_name: r.actor_name ?? r.actor_id } : null,
    a: r.a === null ? null : Number(r.a),
    b: r.b === null ? null : Number(r.b),
    ref: r.ref,
  }));
}

// ── Nhật ký một bước ──
export type LogTaskJson = {
  id: string;
  kind: string;
  status: string;
  result: string | null;
  reason: string | null;
  assignees: string[];
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  feedback: string | null;
  question: string | null;
  answer: string | null;
};
export type LogOutputJson = {
  id: string;
  version: number;
  attempt: number;
  round: number;
  template_ok: boolean;
  created_at: string;
  content: string | null;
};
export type LogRow = StageRow & {
  stage_run_id: string;
  run_id: string;
  tenant_id: string;
  stage_def: SnapStageLite | null;
  tasks: LogTaskJson[];
  outputs: LogOutputJson[];
};

const TS = (c: string) => `to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Bước + task xử lý + đầu ra trong MỘT câu (json_agg lateral, ≤ 20 mỗi loại). `withContent` (debug) mới đọc nội dung đầu ra. */
export async function readStageLog(
  tx: Tx,
  runId: string,
  tenantId: string,
  idx: number,
  withContent: boolean,
): Promise<LogRow | null> {
  const [r] = await tx.execute<LogRow>(sql`
    select s.id as stage_run_id, r.id as run_id, r.tenant_id, r.snapshot->'stages'->(s.stage_idx::int) as stage_def,
      s.stage_idx, s.status, s.attempt, s.attempt_limit, s.round, s.retry_count, s.last_error_code,
      ${iso("s.started_at")} as started_at, ${iso("s.finished_at")} as finished_at, ${iso("s.updated_at")} as updated_at,
      (extract(epoch from (s.finished_at - s.started_at)) * 1000)::bigint as duration_ms,
      coalesce(ag.name->>'vi', tm.name->>'vi') as exec_vi, coalesce(ag.name->>'en', tm.name->>'en') as exec_en,
      coalesce((select json_agg(x order by x.created_at) from (
        select t.id, t.kind, t.status, t.result, t.reason, t.decided_by, du.display_name as decided_by_name,
          ${sql.raw(TS("t.decided_at"))} as decided_at, ${sql.raw(TS("t.created_at"))} as created_at,
          t.feedback, left(t.question, 2000) as question, t.answer,
          to_jsonb(array(select coalesce(au.display_name, ag2.name->>'vi')
            from hub.review_task_assignees ra
            left join admin.users au on au.id = ra.user_id and au.tenant_id = ra.tenant_id
            left join admin.groups ag2 on ag2.id = ra.group_id and ag2.tenant_id = ra.tenant_id
            where ra.task_id = t.id and ra.tenant_id = t.tenant_id and coalesce(au.display_name, ag2.name->>'vi') is not null
            limit 20)) as assignees
        from hub.review_tasks t left join admin.users du on du.id = t.decided_by and du.tenant_id = t.tenant_id
        where t.stage_run_id = s.id and t.tenant_id = s.tenant_id order by t.created_at limit 20) x), '[]'::json) as tasks,
      coalesce((select json_agg(y order by y.version) from (
        select o.id, o.version, o.attempt, o.round, o.template_ok, ${sql.raw(TS("o.created_at"))} as created_at,
          case when ${withContent}::boolean then left(o.content, 4000) end as content
        from hub.process_outputs o where o.stage_run_id = s.id and o.tenant_id = s.tenant_id
        order by o.version limit 20) y), '[]'::json) as outputs
    from hub.stage_runs s
    join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
    ${EXEC_JOIN}
    where s.process_run_id = ${runId} and s.tenant_id = ${tenantId} and s.stage_idx = ${idx}`);
  return r ?? null;
}

export type DebugAttemptJson = {
  run_id: string;
  n: number;
  status: string;
  error_code: string | null;
  error_message: string | null;
  tokens_used: number;
  started_at: string;
  finished_at: string | null;
  jobs: {
    id: string;
    status: string;
    attempts: number;
    error_code: string | null;
    error_reason: string | null;
    error_message: string | null;
    queued_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    payload: unknown;
  }[];
};
export type DebugRow = {
  attempts: DebugAttemptJson[];
  retries: {
    created_at: string;
    due_at: string;
    fired_at: string | null;
    cancelled_at: string | null;
  }[];
  kh_queries: number | null;
  kh_warning: string | null;
};

/** Debug (CHỈ platform_admin; scope `system`): các lần chạy + job (đầu vào payload, lỗi gốc) + hẹn thử lại + kh_stage_usage. */
export async function readDebug(
  tx: Tx,
  tenantId: string,
  stageRunId: string,
  attempt: number,
  round: number,
): Promise<DebugRow> {
  const [r] = await tx.execute<DebugRow>(sql`
    select
      coalesce((select json_agg(q order by q.n) from (
        select rn.id as run_id, row_number() over (order by rn.started_at, rn.id)::int as n, rn.status, rn.error_code,
          left(rn.error_message, 2000) as error_message, rn.tokens_used,
          ${sql.raw(TS("rn.started_at"))} as started_at, ${sql.raw(TS("rn.finished_at"))} as finished_at,
          coalesce((select json_agg(json_build_object('id', j.id, 'status', j.status, 'attempts', j.attempts,
              'error_code', j.error_code, 'error_reason', j.error_reason, 'error_message', left(j.error_message, 2000),
              'queued_at', ${sql.raw(TS("j.queued_at"))}, 'started_at', ${sql.raw(TS("j.started_at"))},
              'finished_at', ${sql.raw(TS("j.finished_at"))},
              'payload', case when length(j.payload::text) <= 50000 then j.payload
                else jsonb_build_object('truncated', true) end) order by j.created_at)
            from hub.jobs j where j.run_id = rn.id and j.tenant_id = rn.tenant_id), '[]'::json) as jobs
        from hub.runs rn where rn.stage_run_id = ${stageRunId} and rn.tenant_id = ${tenantId}
        order by rn.started_at, rn.id limit 20) q), '[]'::json) as attempts,
      coalesce((select json_agg(z order by z.created_at) from (
        select ${sql.raw(TS("tm.created_at"))} as created_at, ${sql.raw(TS("tm.due_at"))} as due_at,
          ${sql.raw(TS("tm.fired_at"))} as fired_at, ${sql.raw(TS("tm.cancelled_at"))} as cancelled_at
        from hub.process_timers tm where tm.stage_run_id = ${stageRunId} and tm.tenant_id = ${tenantId}
          and tm.kind = 'retry' order by tm.created_at limit 20) z), '[]'::json) as retries,
      (select u.queries::int from hub.kh_stage_usage u where u.stage_run_id = ${stageRunId} and u.tenant_id = ${tenantId}
        and u.attempt = ${attempt} and u.round = ${round}) as kh_queries,
      (select u.last_warning from hub.kh_stage_usage u where u.stage_run_id = ${stageRunId} and u.tenant_id = ${tenantId}
        and u.attempt = ${attempt} and u.round = ${round}) as kh_warning`);
  return r ?? { attempts: [], retries: [], kh_queries: null, kh_warning: null };
}
