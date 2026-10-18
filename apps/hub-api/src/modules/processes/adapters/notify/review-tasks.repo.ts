// HUB-FR-112 · HUB-FR-145 · CR-093 · plan-addendum A10/A11 · PD-R18…R20 · K3 lô · repo lô `review_tasks` cho vòng nhắc +
// chuyển cấp (chỉ `systemBatch`). Mỗi hàm = MỘT câu SQL văn bản cố định; dữ liệu lô qua MỘT tham số JSON
// (`jsonb_to_recordset`) — không `unnest`-join bảng lớn, không lặp theo hàng. Khoá `FOR UPDATE SKIP LOCKED` theo
// `(id, tenant_id)`; mọi join/insert khớp `tenant_id` của hàng nguồn. Chỉ làm việc DB; người gọi phát sự kiện SAU COMMIT.
// Dời nguyên từ `notify/batch.repo.ts` (T9) + thêm nhắc lặp / chuyển cấp.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ClaimedEscalation,
  ClaimedReminder,
  EscalateAuditRow,
  EscalatedAssigneeRow,
  EscalationBatch,
  ReminderBatch,
  ReminderMark,
} from "../../application/ports";

const iso = (d: Date): string => d.toISOString();
const date = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

/** Điều kiện tới hạn nhắc — khớp vị từ index `review_tasks_remind_due_idx` (0036) + `dueReminder` (lớp 1). */
const remindDue = (alias: string, now: Date) => sql`${sql.raw(alias)}.status = 'open'
  and (${sql.raw(alias)}.reminded_at is null
    or (${sql.raw(alias)}.remind_every_h is not null and ${sql.raw(alias)}.remind_count < 10))
  and ${sql.raw(alias)}.remind_at <= ${iso(now)}::timestamptz`;

type ReminderRow = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  group_id: string | null;
  remind_at: Date | string;
  reminded_at: Date | string | null;
  remind_every_h: number | null;
  remind_count: number;
  process_name: string | null;
  stage_name: string | null;
  user_ids: string[] | null;
  member_ids: string[] | null;
  more: boolean;
};

/**
 * MỘT câu: khoá task mở tới hạn nhắc (cũ: chưa nhắc; lặp: `remind_count < 10`), bỏ qua hàng Hub khác đang khoá (#190),
 * trả kèm tên quy trình/bước + người nhận = user assignee ∪ thành viên MỌI Group assignee (gồm Group chuyển cấp, PD-R21).
 * Group chuyển cấp lấy từ chính hàng task (`escalated_at` đặt ⇒ `escalate_group_id`; Group bị bỏ qua vì khác tenant/đã xoá ⇒ 0
 * thành viên do lọc `gm.tenant_id`) — không quét `review_task_assignees` theo Group (không có index `task_id` cho hàng
 * Group). Người nhận qua subquery tương quan theo index (`= any(array)`), khớp `tenant_id` task nguồn (K3 lô). Không ghi —
 * `markRemindedMany` áp mốc kế do lớp 1 tính.
 */
export async function claimDueReminders(tx: Tx, now: Date, limit: number): Promise<ReminderBatch> {
  const q = sql`
    with c as (
      select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, t.assignee_group_id, t.remind_at, t.reminded_at,
        t.remind_every_h, t.remind_count, t.escalate_group_id, t.escalated_at
      from hub.review_tasks t
      where ${remindDue("t", now)}
      order by t.remind_at asc, t.id asc
      limit ${limit}
      for update of t skip locked
    )
    select c.id, c.tenant_id, c.process_run_id, c.assignee_group_id as group_id, c.remind_at, c.reminded_at,
      c.remind_every_h::int as remind_every_h, c.remind_count::int as remind_count,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name,
      array(select a.user_id::text from hub.review_task_assignees a
        where a.task_id = c.id and a.tenant_id = c.tenant_id and a.user_id is not null) as user_ids,
      array(select gm.user_id::text from admin.group_members gm
        where gm.tenant_id = c.tenant_id and gm.group_id = any(array[c.assignee_group_id,
          case when c.escalated_at is not null then c.escalate_group_id end])) as member_ids,
      exists (select 1 from hub.review_tasks t2
        where ${remindDue("t2", now)} and not exists (select 1 from c where c.id = t2.id)) as more
    from c
    left join hub.stage_runs s on s.id = c.stage_run_id and s.tenant_id = c.tenant_id
    left join hub.process_runs pr on pr.id = c.process_run_id and pr.tenant_id = c.tenant_id
    order by c.remind_at asc, c.id asc`;
  const rows = await tx.execute<ReminderRow>(q);
  const tasks: ClaimedReminder[] = rows.map((r) => ({
    taskId: r.id,
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    groupId: r.group_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
    userIds: r.user_ids ?? [],
    groupMemberIds: r.member_ids ?? [],
    remindAt: new Date(r.remind_at),
    remindedAt: date(r.reminded_at),
    remindEveryH: r.remind_every_h === null ? null : Number(r.remind_every_h),
    remindCount: Number(r.remind_count),
  }));
  return { tasks, more: rows[0]?.more === true };
}

/**
 * MỘT câu: áp mốc nhắc kế (lớp 1 `nextRemind`) cho cả lô — `update … from jsonb_to_recordset` theo `(id, tenant_id)`
 * (PK, không phụ thuộc thống kê); `reminded_at = now` (cũ: đúng 1 lần — HUB-BR-26). Guard `status = 'open'`.
 */
export async function markRemindedMany(
  tx: Tx,
  now: Date,
  rows: readonly ReminderMark[],
): Promise<void> {
  const json = JSON.stringify(
    rows.map((r) => ({
      id: r.taskId,
      tenant_id: r.tenantId,
      remind_at: iso(r.remindAt),
      remind_count: r.remindCount,
    })),
  );
  // JSON gom thành MỘT hàng mảng ⇒ nested loop 1 hàng ngoài + `id = any(ids)` tra PK (không hash/seq scan theo thống
  // kê cũ sau chèn hàng loạt); giá trị mỗi hàng lấy theo vị trí, `tenant_id` phải khớp hàng nguồn (K3 lô).
  await tx.execute(sql`
    with x as (
      select array_agg(r.id) as ids, array_agg(r.tenant_id) as tids, array_agg(r.remind_at) as ats,
        array_agg(r.remind_count) as cnts
      from jsonb_to_recordset(${json}::jsonb) as r(id uuid, tenant_id uuid, remind_at timestamptz, remind_count int)
    )
    update hub.review_tasks t
    set reminded_at = ${iso(now)}::timestamptz,
      remind_at = x.ats[array_position(x.ids, t.id)],
      remind_count = x.cnts[array_position(x.ids, t.id)]
    from x
    where t.id = any(x.ids) and t.tenant_id = x.tids[array_position(x.ids, t.id)] and t.status = 'open'`);
}

type EscalationRow = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  from_group_id: string | null;
  to_group_id: string;
  group_tenant_id: string | null;
  process_name: string | null;
  stage_name: string | null;
  member_ids: string[] | null;
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
  const rows = await tx.execute<EscalationRow>(sql`
    with c as (
      select t.id, t.tenant_id from hub.review_tasks t
      where t.status = 'open' and t.escalated_at is null and t.escalate_at is not null
        and t.escalate_at <= ${iso(now)}::timestamptz and t.kind = 'review'
      order by t.escalate_at asc, t.id asc
      limit ${limit}
      for update of t skip locked
    ), u as (
      update hub.review_tasks t set escalated_at = ${iso(now)}::timestamptz
      from c where t.id = c.id and t.tenant_id = c.tenant_id
      returning t.id, t.tenant_id, t.process_run_id, t.stage_run_id, t.assignee_group_id, t.escalate_group_id,
        t.escalate_at
    )
    select u.id, u.tenant_id, u.process_run_id, u.assignee_group_id as from_group_id,
      u.escalate_group_id as to_group_id, g.tenant_id as group_tenant_id,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name,
      array(select gm.user_id::text from admin.group_members gm
        where gm.group_id = g.id and gm.tenant_id = u.tenant_id) as member_ids,
      exists (select 1 from hub.review_tasks t2
        where t2.status = 'open' and t2.escalated_at is null and t2.escalate_at is not null
          and t2.escalate_at <= ${iso(now)}::timestamptz and t2.kind = 'review'
          and not exists (select 1 from c where c.id = t2.id)) as more
    from u
    left join admin.groups g on g.id = u.escalate_group_id and g.tenant_id = u.tenant_id
    left join hub.stage_runs s on s.id = u.stage_run_id and s.tenant_id = u.tenant_id
    left join hub.process_runs pr on pr.id = u.process_run_id and pr.tenant_id = u.tenant_id
    order by u.escalate_at asc, u.id asc`);
  const tasks: ClaimedEscalation[] = rows.map((r) => ({
    taskId: r.id,
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    fromGroupId: r.from_group_id,
    toGroupId: r.to_group_id,
    groupTenantId: r.group_tenant_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
    memberIds: r.member_ids ?? [],
  }));
  return { tasks, more: rows[0]?.more === true };
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

/** Làm nóng: chạy đủ văn bản câu của vòng nhắc + chuyển cấp với lô rỗng (không ghi hàng nào). */
export async function warmReviewTasks(tx: Tx): Promise<void> {
  const epoch = new Date(0);
  await claimDueReminders(tx, epoch, 0);
  await markRemindedMany(tx, epoch, []);
  await claimDueEscalations(tx, epoch, 0);
  await addEscalatedGroups(tx, []);
  await auditEscalations(tx, []);
}
