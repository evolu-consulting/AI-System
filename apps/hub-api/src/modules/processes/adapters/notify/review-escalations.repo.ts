// HUB-FR-145 · PD-R20 · PD-R21 · K3/K4 lô · repo lô chuyển cấp `review_tasks` (claim-update + gán Group + audit), tách khỏi
// `review-tasks.repo.ts` để giữ trần 200 dòng adapter (PD-A03). Cùng quy tắc: MỘT câu SQL văn bản cố định, dữ liệu lô qua
// MỘT tham số JSON, khoá `FOR UPDATE SKIP LOCKED`, khớp `tenant_id` hàng nguồn; xem đầu `review-tasks.repo.ts` (T12 #1).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ClaimedEscalation,
  EscalateAuditRow,
  EscalatedAssigneeRow,
  EscalationBatch,
} from "../../application/ports";

const iso = (d: Date): string => d.toISOString();
type EscalationRow = {
  claimed: number | string;
  id: string | null;
  tenant_id: string;
  process_run_id: string;
  from_group_id: string | null;
  to_group_id: string;
  group_tenant_id: string | null;
  process_name: string | null;
  stage_name: string | null;
  member_ids: string[] | null;
  group_name: string | null;
  after_h: number | string | null;
  more: boolean;
};

/**
 * MỘT câu claim-update (PD-R20): khoá task review mở tới hạn chuyển cấp (SKIP LOCKED), đặt `escalated_at = now` (guard
 * `escalated_at IS NULL` ⇒ hai instance chỉ một lần), trả Group đích (CHỈ thấy khi cùng tenant task — K4) + thành viên.
 */
export async function claimDueEscalations(
  tx: Tx,
  now: Date,
  limit: number,
): Promise<EscalationBatch> {
  const all = await tx.execute<EscalationRow>(sql`
    with c0 as (
      select t.id, t.tenant_id, t.process_run_id from hub.review_tasks t
      where t.status = 'open' and t.escalated_at is null and t.escalate_at is not null
        and t.escalate_at <= ${iso(now)}::timestamptz and t.kind = 'review'
      order by t.escalate_at asc, t.id asc
      limit ${limit}
      for update of t skip locked
    ), r as (
      select pr.id, pr.tenant_id from hub.process_runs pr
      where pr.id = any(array(select process_run_id from c0)) and pr.tenant_id = any(array(select tenant_id from c0))
      for key share skip locked
    ), c as (
      select c0.id, c0.tenant_id from c0 join r on r.id = c0.process_run_id and r.tenant_id = c0.tenant_id
    ), u as (
      update hub.review_tasks t set escalated_at = ${iso(now)}::timestamptz
      from c where t.id = c.id and t.tenant_id = c.tenant_id
      returning t.id, t.tenant_id, t.process_run_id, t.stage_run_id, t.assignee_group_id, t.escalate_group_id,
        t.escalate_at
    )
    select n.claimed, u.id, u.tenant_id, u.process_run_id, u.assignee_group_id as from_group_id,
      u.escalate_group_id as to_group_id, g.tenant_id as group_tenant_id, g.name->>'vi' as group_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->'after'->'escalate'->>'after_h' as after_h,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name,
      array(select gm.user_id::text from admin.group_members gm
        where gm.group_id = g.id and gm.tenant_id = u.tenant_id) as member_ids,
      exists (select 1 from hub.review_tasks t2
        where t2.status = 'open' and t2.escalated_at is null and t2.escalate_at is not null
          and t2.escalate_at <= ${iso(now)}::timestamptz and t2.kind = 'review'
          and not exists (select 1 from c where c.id = t2.id)) as more
    from (select count(*)::int as claimed from c0) n
    left join u on true
    left join admin.groups g on g.id = u.escalate_group_id and g.tenant_id = u.tenant_id
    left join hub.stage_runs s on s.id = u.stage_run_id and s.tenant_id = u.tenant_id
    left join hub.process_runs pr on pr.id = u.process_run_id and pr.tenant_id = u.tenant_id
    order by u.escalate_at asc, u.id asc`);
  const rows = all.filter((r): r is EscalationRow & { id: string } => r.id !== null);
  return {
    tasks: rows.map(toEscalation),
    claimed: Number(all[0]?.claimed ?? 0),
    more: all[0]?.more === true,
  };
}

function toEscalation(r: EscalationRow & { id: string }): ClaimedEscalation {
  return {
    taskId: r.id,
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    fromGroupId: r.from_group_id,
    toGroupId: r.to_group_id,
    groupTenantId: r.group_tenant_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
    memberIds: r.member_ids ?? [],
    groupName: r.group_name,
    afterH: r.after_h === null || !Number.isInteger(Number(r.after_h)) ? null : Number(r.after_h),
  };
}

/** MỘT câu nhiều hàng: assignee Group `via='escalated'`; `tenant_id` = task nguồn, Group phải cùng tenant (K3/K4). */
export async function addEscalatedGroups(
  tx: Tx,
  rows: readonly EscalatedAssigneeRow[],
): Promise<void> {
  const json = JSON.stringify(
    rows.map((r) => ({ tenant_id: r.tenantId, task_id: r.taskId, group_id: r.groupId })),
  );
  await tx.execute(sql`
    insert into hub.review_task_assignees (tenant_id, task_id, group_id, via, depth)
    select x.tenant_id, x.task_id, x.group_id, 'escalated', 0
    from jsonb_to_recordset(${json}::jsonb) as x(tenant_id uuid, task_id uuid, group_id uuid)
    where exists (select 1 from admin.groups g where g.id = x.group_id and g.tenant_id = x.tenant_id)`);
}

/** MỘT câu nhiều hàng: audit `escalate` / `escalate_skipped` (actor hệ thống = NULL, TC3 `summary {from_group, to_group}`). */
export async function auditEscalations(tx: Tx, rows: readonly EscalateAuditRow[]): Promise<void> {
  const json = JSON.stringify(
    rows.map((r) => ({
      tenant_id: r.tenantId,
      action: r.action,
      entity_id: r.taskId,
      entity_name: Array.from(r.entityName).slice(0, 200).join(""),
      summary: { from_group: r.fromGroupId, to_group: r.toGroupId },
    })),
  );
  await tx.execute(sql`
    insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name, summary)
    select x.tenant_id, null, null, x.action, 'review_task', x.entity_id, x.entity_name, x.summary
    from jsonb_to_recordset(${json}::jsonb)
      as x(tenant_id uuid, action text, entity_id uuid, entity_name text, summary jsonb)`);
}
