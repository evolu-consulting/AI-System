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
  return sql`coalesce(${approverSql(stage, tenant)}, (select d.head_user_id from admin.departments d
    where (${st}->'after'->>'kind') = 'review' and (${st}->'after'->>'head_only') = 'true'
      and d.group_id = nullif(${st}->'after'->>'group_id', '')::uuid and d.tenant_id = ${tid}))`;
}

/** esign-flow · người duyệt cụ thể của stage review (`after.approver_user_id`) CHỈ khi là user cùng tenant, còn dùng được (active,
 *  không bị khoá); vắng / không thấy ⇒ NULL (rơi về cửa trưởng phòng / cả Group). Một subquery theo PK `admin.users`. */
export function approverSql(stage: string, tenant: string): SQL {
  const st = sql.raw(stage);
  const tid = sql.raw(tenant);
  return sql`(select u.id from admin.users u
    where (${st}->'after'->>'kind') = 'review'
      and u.id = nullif(${st}->'after'->>'approver_user_id', '')::uuid
      and u.tenant_id = ${tid} and u.active and not u.locked_by_tenant)`;
}

/** esign-flow · như `approverSql` cho cổng quyết (TS): người duyệt cụ thể còn hợp lệ ở tenant hoặc null. */
export async function approverOf(
  tx: Tx,
  tenantId: string,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const [r] = await tx.execute<{ id: string }>(sql`select id from admin.users
    where id = ${id} and tenant_id = ${tenantId} and active and not locked_by_tenant`);
  return r?.id ?? null;
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
