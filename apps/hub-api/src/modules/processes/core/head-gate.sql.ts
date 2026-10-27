// contract-flow S1b · cửa trưởng phòng (SQL) của stage `after.head_only` — cùng luật `headGate` (domain/tasks/task-access):
// stage head_only + Group duyệt có trưởng phòng (`admin.departments.head_user_id`, CÙNG tenant của hàng nguồn) ⇒ id trưởng phòng;
// còn lại NULL (cả nhóm). Một subquery theo PK `departments(group_id)`; `head_only` đọc từ snapshot run (đã chụp lúc start).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

/** `stage` = biểu thức jsonb stage của snapshot (vd `pr.snapshot->'stages'->(s.stage_idx::int)`), `tenant` = cột tenant. */
export function headGateSql(stage: string, tenant: string): SQL {
  const st = sql.raw(stage);
  const tid = sql.raw(tenant);
  // esign-flow · `after.approver_user_id` (người duyệt cụ thể) thắng cửa trưởng phòng.
  return sql`coalesce(${approverSql(stage)}, (select d.head_user_id from admin.departments d
    where (${st}->'after'->>'kind') = 'review' and (${st}->'after'->>'head_only') = 'true'
      and d.group_id = nullif(${st}->'after'->>'group_id', '')::uuid and d.tenant_id = ${tid}))`;
}

/** esign-flow · người duyệt cụ thể của stage review (`after.approver_user_id`); vắng ⇒ NULL. */
export function approverSql(stage: string): SQL {
  const st = sql.raw(stage);
  return sql`(case when (${st}->'after'->>'kind') = 'review'
    then nullif(${st}->'after'->>'approver_user_id', '')::uuid end)`;
}

/** Trưởng phòng của Group assignee của task (alias `t` của `hub.review_tasks`), cùng tenant; null = không có. */
export function groupHeadSql(t: string): SQL {
  const a = sql.raw(t);
  return sql`(select d.head_user_id from admin.departments d
    where d.group_id = ${a}.assignee_group_id and d.tenant_id = ${a}.tenant_id)`;
}

/** Trưởng phòng của Group (cùng tenant); không phòng/không trưởng ⇒ null. */
export async function headOf(tx: Tx, tenantId: string, groupId: string): Promise<string | null> {
  const [r] = await tx.execute<{ h: string | null }>(sql`select head_user_id as h
    from admin.departments where group_id = ${groupId} and tenant_id = ${tenantId}`);
  return r?.h ?? null;
}
