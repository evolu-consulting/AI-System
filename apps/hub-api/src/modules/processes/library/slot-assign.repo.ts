// CR-105 · L2a · SQL gán tenant × khe, mặc định khe, tập tenant bị ảnh hưởng (B2 Group theo tenant, B5 tác động). Scope system sau
// cổng platform_admin. Tập tenant "đang dùng" def D của khe S: gán tới D ∪ (D là mặc định ⇒ tenant bật gói của khe mà CHƯA gán).
// Mỗi hàm MỘT câu cố định (lọc qua PK/index; mảng qua literal tham số) — Luật 4c.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/** Mảng tham số qua MỘT tham số JSON (không ghép chuỗi literal `{a,b}` — review CR-105); kiểu ép phía SQL. */
const arr = (xs: readonly string[], t: "uuid" | "text") =>
  sql`array(select jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb))::${sql.raw(t)}[]`;
const ACTIVE = sql`('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;

export type Affected = {
  slot: string;
  /** Feature đọc của gói khe (`<pack>-read`): tenant "bật gói". */
  feature: string;
  /** Gán tới def này (xuất bản/quay lại). */
  defId: string | null;
  /** Def là (hoặc sắp là) mặc định ⇒ cộng tenant bật gói chưa gán. */
  asDefault: boolean;
  /** Tenant chỉ định (gán). */
  tenantIds: readonly string[];
};

const affectedCte = (a: Affected) => sql`t as (
    select x.tenant_id from hub.process_slot_assignments x where x.def_id = ${a.defId}::uuid
    union
    select e.tenant_id from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
    where ${a.asDefault} and f.key = ${a.feature} and f.status <> 'off' and e.revoked_at is null
      and not exists (select 1 from hub.process_slot_assignments y where y.tenant_id = e.tenant_id and y.slot = ${a.slot})
    union
    select unnest(${arr(a.tenantIds, "uuid")}))`;

export type GroupMiss = { tenant_id: string; tenant: string; keys: string[]; users: string[] };

/** B2 · tenant đầu tiên (theo mã) thiếu Group theo mã `keys` hoặc user `users` (người duyệt cụ thể) — null nếu đủ. */
export async function firstMiss(
  tx: Tx,
  a: Affected,
  need: { keys: readonly string[]; users: readonly string[] },
): Promise<GroupMiss | null> {
  if (need.keys.length === 0 && need.users.length === 0) return null;
  const [r] = await tx.execute<GroupMiss>(sql`with ${affectedCte(a)}, m as (
      select t.tenant_id, tn.key as tenant,
        array(select k from unnest(${arr(need.keys, "text")}) k where not exists
          (select 1 from admin.groups g where g.tenant_id = t.tenant_id and g.key = k)) as keys,
        array(select u::text from unnest(${arr(need.users, "uuid")}) u where not exists
          (select 1 from admin.users x where x.tenant_id = t.tenant_id and x.id = u)) as users
      from t join admin.tenants tn on tn.id = t.tenant_id)
    select tenant_id::text as tenant_id, tenant, keys, users from m
    where cardinality(keys) > 0 or cardinality(users) > 0 order by tenant limit 1`);
  return r ?? null;
}

/** B5 · số tenant đang dùng + lượt đang chạy của họ trên def tenant vật chất hoá (`source_ref`). */
export async function impactOf(
  tx: Tx,
  a: Affected,
): Promise<{ tenant_count: number; active_runs: number }> {
  const [r] = await tx.execute<{
    tenant_count: number;
    active_runs: number;
  }>(sql`with ${affectedCte(a)}
    select (select count(*)::int from t) as tenant_count,
      (select count(*)::int from hub.process_runs r join hub.process_defs d on d.id = r.process_def_id
        where r.tenant_id in (select tenant_id from t) and d.tenant_id = r.tenant_id and d.source_ref is not null
          and r.status in ${ACTIVE}) as active_runs`);
  return { tenant_count: Number(r?.tenant_count ?? 0), active_runs: Number(r?.active_runs ?? 0) };
}

export type AssignmentRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_key: string;
  assigned_at: string;
};
export const listAssignments = (tx: Tx, defId: string): Promise<AssignmentRow[]> =>
  tx.execute<AssignmentRow>(sql`select a.tenant_id::text as tenant_id, tn.name as tenant_name,
      tn.key as tenant_key, ${iso(sql`a.assigned_at`)} as assigned_at
    from hub.process_slot_assignments a join admin.tenants tn on tn.id = a.tenant_id
    where a.def_id = ${defId} order by tn.key limit 1000`);

export async function tenantOf(
  tx: Tx,
  tenantId: string,
): Promise<{ key: string; name: string } | null> {
  const [r] = await tx.execute<{ key: string; name: string }>(
    sql`select key, name from admin.tenants where id = ${tenantId}`,
  );
  return r ?? null;
}

/** Gán (thay thế) — trả def cũ (null = trước đó chạy mặc định). */
export async function upsertAssignment(
  tx: Tx,
  w: { tenantId: string; slot: string; defId: string; actorId: string },
): Promise<string | null> {
  const [r] = await tx.execute<{ prev: string | null }>(sql`with old as (
      select def_id from hub.process_slot_assignments where tenant_id = ${w.tenantId} and slot = ${w.slot} for update),
    up as (insert into hub.process_slot_assignments (tenant_id, slot, def_id, assigned_by)
      values (${w.tenantId}, ${w.slot}, ${w.defId}, ${w.actorId})
      on conflict (tenant_id, slot) do update set def_id = excluded.def_id, assigned_by = excluded.assigned_by,
        assigned_at = now() returning 1)
    select (select def_id::text from old) as prev from up`);
  return r?.prev ?? null;
}

export async function deleteAssignment(
  tx: Tx,
  tenantId: string,
  slot: string,
): Promise<string | null> {
  const [r] = await tx.execute<{ def_id: string }>(sql`delete from hub.process_slot_assignments
    where tenant_id = ${tenantId} and slot = ${slot} returning def_id::text as def_id`);
  return r?.def_id ?? null;
}

export type SlotRow = {
  slot: string;
  default_def_id: string | null;
  default_def_name: string | null;
};
export const slotRows = (tx: Tx): Promise<SlotRow[]> =>
  tx.execute<SlotRow>(sql`select s.slot, s.default_def_id::text as default_def_id, d.name as default_def_name
    from hub.process_slots s left join hub.process_defs d on d.id = s.default_def_id order by s.slot`);

/** Mã Group đã thấy ở các tenant (gợi ý Form), tối đa 200. */
export async function groupKeysSeen(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ key: string }>(
    sql`select distinct key from admin.groups order by key limit 200`,
  );
  return rows.map((r) => r.key);
}

export async function upsertSlotDefault(
  tx: Tx,
  w: { slot: string; defId: string; actorId: string },
): Promise<void> {
  await tx.execute(sql`insert into hub.process_slots (slot, default_def_id, updated_by)
    values (${w.slot}, ${w.defId}, ${w.actorId})
    on conflict (slot) do update set default_def_id = excluded.default_def_id, updated_by = excluded.updated_by,
      updated_at = now()`);
}

export type TenantSlotRow = {
  slot: string;
  def_id: string | null;
  def_name: string | null;
  rel_version: number | null;
  is_default: boolean;
};
/** Khe của tenant: gán ⇒ def đó, không ⇒ mặc định khe; `slots` = khe đã đăng ký (gồm khe chưa có mặc định). */
export const tenantSlotRows = (
  tx: Tx,
  tenantId: string,
  slots: readonly string[],
): Promise<TenantSlotRow[]> =>
  tx.execute<TenantSlotRow>(sql`with k as (
      select slot from hub.process_slots union select unnest(${arr(slots, "text")})
      union select slot from hub.process_slot_assignments where tenant_id = ${tenantId})
    select k.slot, d.id::text as def_id, d.name as def_name, d.published_version as rel_version,
      (a.def_id is null) as is_default
    from k left join hub.process_slot_assignments a on a.tenant_id = ${tenantId} and a.slot = k.slot
      left join hub.process_slots s on s.slot = k.slot
      left join hub.process_defs d on d.id = coalesce(a.def_id, s.default_def_id) and d.deleted_at is null
    order by k.slot`);
