// CR-105 · L2a · SQL gán tenant × khe, mặc định khe, tập tenant bị ảnh hưởng (B2 Group theo tenant, B5 tác động). Scope system sau
// cổng platform_admin. Tập tenant "đang dùng" def D của khe S: gán tới D ∪ (D là mặc định ⇒ tenant bật gói của khe mà CHƯA gán).
// Mỗi hàm MỘT câu cố định (lọc qua PK/index; mảng qua literal tham số) — Luật 4c.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { AppError } from "../../../lib/errors";

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

// CR-120 · một nguồn: tenant có def trong tập gán (luật chỉ trỏ def trong tập — FK) ∪ (def là mẫu khe ⇒ tenant bật gói chưa có luật
// mặc định, đang rơi về mẫu) ∪ tenant chỉ định.
const affectedCte = (a: Affected) => sql`t as (
    select x.tenant_id from hub.process_tenant_defs x where x.def_id = ${a.defId}::uuid
    union
    select e.tenant_id from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
    where ${a.asDefault} and f.key = ${a.feature} and f.status <> 'off' and e.revoked_at is null
      and not exists (select 1 from hub.process_routing_rules y
        where y.tenant_id = e.tenant_id and y.slot = ${a.slot} and y.is_default)
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
  in_use: boolean;
};
/** CR-120 · một nguồn: tenant có def trong tập gán (`process_tenant_defs`, index def_id); `in_use` = luật (mặc định hoặc điều kiện)
 *  của tenant × khe trỏ def. Một câu. */
export const listAssignments = (tx: Tx, defId: string): Promise<AssignmentRow[]> =>
  tx.execute<AssignmentRow>(sql`select a.tenant_id::text as tenant_id, tn.name as tenant_name,
      tn.key as tenant_key, ${iso(sql`a.assigned_at`)} as assigned_at,
      exists (select 1 from hub.process_routing_rules r
        where r.tenant_id = a.tenant_id and r.slot = a.slot and r.def_id = a.def_id) as in_use
    from hub.process_tenant_defs a join admin.tenants tn on tn.id = a.tenant_id
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

/**
 * Gán (thay thế) — trả def cũ của luật mặc định (null = trước đó chưa có). CR-120 · ADR-0036: ghi NGUỒN DUY NHẤT trong tx của
 * người gọi — tập gán (`process_tenant_defs`, có sẵn ⇒ giữ) + đầu luật (`version` + 1 ⇒ màn luật đang mở nhận 409) + luật
 * `is_default` (có ⇒ đổi def, không ⇒ chèn ở priority trống cao nhất ≤ 49). Bốn câu cố định.
 */
export async function upsertAssignment(
  tx: Tx,
  w: { tenantId: string; slot: string; defId: string; actorId: string },
): Promise<string | null> {
  // Khoá đầu luật trước (ghi tuần tự với PUT luật), rồi đọc def cũ.
  await tx.execute(sql`insert into hub.process_routings (tenant_id, slot, version, updated_by)
    values (${w.tenantId}, ${w.slot}, 1, ${w.actorId})
    on conflict (tenant_id, slot) do update set version = hub.process_routings.version + 1,
      updated_by = excluded.updated_by, updated_at = now()`);
  const [old] = await tx.execute<{ prev: string }>(sql`select def_id::text as prev
    from hub.process_routing_rules where tenant_id = ${w.tenantId} and slot = ${w.slot} and is_default`);
  await tx.execute(sql`insert into hub.process_tenant_defs (tenant_id, def_id, slot, assigned_by)
    values (${w.tenantId}, ${w.defId}, ${w.slot}, ${w.actorId}) on conflict do nothing`);
  const [done] = await tx.execute<{
    n: number;
  }>(sql`with u as (update hub.process_routing_rules set def_id = ${w.defId}::uuid, source = 'admin'
      where tenant_id = ${w.tenantId} and slot = ${w.slot} and is_default returning 1),
    i as (insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      select ${w.tenantId}::uuid, ${w.slot}, p, '{}'::jsonb, ${w.defId}::uuid, true
      from (select max(g) as p from generate_series(0, 49) g where not exists (select 1 from hub.process_routing_rules x
        where x.tenant_id = ${w.tenantId} and x.slot = ${w.slot} and x.priority = g)) f
      where f.p is not null and not exists (select 1 from u) returning 1)
    select ((select count(*) from u) + (select count(*) from i))::int as n`);
  // 50 luật đã đầy (priority 0..49) và chưa có luật mặc định ⇒ KHÔNG im lặng: 409 (tx của người gọi hoàn tác cả đầu luật + tập gán).
  if (Number(done?.n ?? 0) === 0)
    throw new AppError(
      "ROUTING_RULES_FULL",
      409,
      "Khe này đã đủ 50 luật định tuyến cho công ty — xoá bớt một luật rồi gán lại.",
    );
  return old?.prev ?? null;
}

/** hub-routing-backfill · def thôi là gán cũ (bỏ gán / bị thay) ⇒ bỏ khỏi tập gán, TRỪ khi luật còn dùng (giữ; FK luật cũng
 *  chặn). Một câu; trả true nếu đã bỏ, false nếu giữ / không có. */
export async function releaseFromSet(
  tx: Tx,
  w: { tenantId: string; slot: string; defId: string },
): Promise<boolean> {
  const r = await tx.execute(sql`delete from hub.process_tenant_defs a
    where a.tenant_id = ${w.tenantId} and a.slot = ${w.slot} and a.def_id = ${w.defId}
      and not exists (select 1 from hub.process_routing_rules x
        where x.tenant_id = a.tenant_id and x.slot = a.slot and x.def_id = a.def_id)`);
  return r.count === 1;
}

export async function deleteAssignment(
  tx: Tx,
  tenantId: string,
  slot: string,
): Promise<string | null> {
  // CR-120 · bỏ gán = xoá luật `is_default` (tenant về mẫu khe; `ensureSlotDefaults` cấp lại đúng mẫu khi không còn luật nào).
  // Đầu luật `version` + 1 (màn luật đang mở nhận 409). Hai câu.
  const [r] = await tx.execute<{ def_id: string }>(sql`delete from hub.process_routing_rules
    where tenant_id = ${tenantId} and slot = ${slot} and is_default returning def_id::text as def_id`);
  if (r)
    await tx.execute(sql`update hub.process_routings set version = version + 1, updated_at = now()
      where tenant_id = ${tenantId} and slot = ${slot}`);
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
/** Khe của tenant: luật mặc định (CR-120, nguồn duy nhất) ⇒ def đó, không ⇒ mẫu khe; `is_default` = đang chạy đúng mẫu khe;
 *  `slots` = khe đã đăng ký (gồm khe chưa có mặc định). */
export const tenantSlotRows = (
  tx: Tx,
  tenantId: string,
  slots: readonly string[],
): Promise<TenantSlotRow[]> =>
  tx.execute<TenantSlotRow>(sql`with k as (
      select slot from hub.process_slots union select unnest(${arr(slots, "text")})
      union select slot from hub.process_routing_rules where tenant_id = ${tenantId} and is_default)
    select k.slot, d.id::text as def_id, d.name as def_name, coalesce(d.published_version, d.source_rel_version) as rel_version,
      (a.def_id is null or coalesce(a.def_id = s.default_def_id, false)) as is_default
    from k left join hub.process_routing_rules a on a.tenant_id = ${tenantId} and a.slot = k.slot and a.is_default
      left join hub.process_slots s on s.slot = k.slot
      left join hub.process_defs d on d.id = coalesce(a.def_id, s.default_def_id) and d.deleted_at is null
    order by k.slot`);
