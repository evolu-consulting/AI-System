// HUB-FR-106 · HUB-FR-145 · AC-H42 · D2-47 · `history` của full view (GET /process-runs/:id) — tách từ `runs.repo.ts`
// (trần 400 dòng) khi thêm mục `escalate`. MỘT câu (union all) cho cả review/decision đã đóng và chuyển cấp.
import type { HistoryItem } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

const iso = (c: SQL) => sql`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type HistoryRow = {
  task_id: string;
  kind: HistoryItem["kind"];
  stage_idx: number;
  result: HistoryItem["result"] | null;
  feedback: string | null;
  decided_by: string | null;
  actor_name: string | null;
  at: string | null;
  group_id: string | null;
  group_name: string | null;
  after_h: number | string | null;
  to_step: number | null;
  rule: number | null;
};

function toHistoryItem(h: HistoryRow): HistoryItem {
  const afterH = Number(h.after_h);
  return {
    at: h.at ?? new Date(0).toISOString(),
    kind: h.kind,
    task_id: h.task_id,
    stage_idx: Number(h.stage_idx),
    actor: h.decided_by ? { id: h.decided_by, display_name: h.actor_name ?? h.decided_by } : null,
    ...(h.result && { result: h.result, ...(h.feedback && { feedback: h.feedback }) }),
    ...(h.group_id && { group: { id: h.group_id, name: h.group_name || h.group_id } }),
    ...(h.after_h !== null && Number.isInteger(afterH) && afterH >= 1 && { after_h: afterH }),
    ...(h.to_step !== null && { to_step: Number(h.to_step) }),
    ...(h.rule !== null && { rule: Number(h.rule) }),
  };
}

/**
 * `history` full view theo thời gian (≤ 200): task review/decision đã đóng + mục `escalate` (task review đã chuyển cấp
 * THẬT — có assignee `via='escalated'`; Group, `after_h` của snapshot) + mục `branch` (audit, `to_step` + `rule`, T19).
 * `ask`/`forward` ở thread (plan-thread §2).
 */
export async function loadHistory(tx: Tx, runId: string, tenantId: string): Promise<HistoryItem[]> {
  const rows = await tx.execute<HistoryRow>(sql`
    select h.task_id, h.kind, h.stage_idx, h.result, h.feedback, h.decided_by, h.actor_name,
      ${iso(sql`h.at_ts`)} as at, h.group_id, h.group_name, h.after_h, h.to_step, h.rule
    from (
      select t.id as task_id, t.kind, s.stage_idx, t.result, t.feedback, t.decided_by,
        u.display_name as actor_name, t.decided_at as at_ts, t.created_at as c_ts,
        null::uuid as group_id, null::text as group_name, null::text as after_h,
        null::int as to_step, null::int as rule
      from hub.review_tasks t
      join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      left join admin.users u on u.id = t.decided_by and u.tenant_id = t.tenant_id
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.status = 'closed'
        and t.kind in ('review', 'decision')
      union all
      select t.id, 'escalate', s.stage_idx, null, null, null, null, t.escalated_at, t.created_at,
        esc.group_id, esc.name, pr.snapshot->'stages'->(s.stage_idx::int)->'after'->'escalate'->>'after_h',
        null, null
      from hub.review_tasks t
      join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
      join lateral (select a.group_id, eg.name->>'vi' as name
          from hub.review_task_assignees a
          left join admin.groups eg on eg.id = a.group_id and eg.tenant_id = a.tenant_id
          where a.task_id = t.id and a.tenant_id = t.tenant_id and a.via = 'escalated' and a.group_id is not null
          limit 1) esc on true
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.kind = 'review'
        and t.escalated_at is not null
      union all
      -- P-d2 · PD2-R14 · rẽ nhánh: audit branch (actor hệ thống), payload ở summary (index entity, entity_id).
      select null, 'branch', (a.summary->>'stage_idx')::int, null, null, null, null, a.at, a.at,
        null, null, null, (a.summary->>'to_step')::int, (a.summary->>'rule')::int
      from hub.audit_log a
      where a.entity = 'process_run' and a.entity_id = ${runId} and a.tenant_id = ${tenantId}
        and a.action = 'branch'
    ) h
    order by h.at_ts nulls last, h.c_ts limit 200`);
  return rows.map(toHistoryItem);
}
