// niti-onboard · SQL theo tập của onboarding tenant: mỗi hàm MỘT câu văn bản cố định, dữ liệu lô qua MỘT tham số JSON (Luật 4c).
// Chạy dưới `admin_api` scope platform (RLS bật); mọi câu ghi mang `tenant_id` tường minh.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { DeptRow } from "../domain/onboard.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
const json = (x: unknown): string => JSON.stringify(x);

export async function actorOk(tx: Tx, actorId: string): Promise<boolean> {
  const [r] = await run<{ ok: boolean }>(
    tx,
    sql`select exists (select 1 from admin.users u join admin.tenants t on t.id = u.tenant_id
      where u.id = ${actorId}::uuid and u.role = 'platform_admin' and u.active and not u.locked_by_tenant
        and t.active) as ok`,
  );
  return r?.ok === true;
}

export type TenantNow = {
  id: string;
  name: string;
  timezone: string;
  profile: Record<string, unknown>;
  src: string | null;
  org: string | null;
};

/** Tenant theo key, khoá hàng (chạy đồng thời hai lần ⇒ tuần tự). */
export async function lockTenant(tx: Tx, key: string): Promise<TenantNow | null> {
  const [r] = await run<TenantNow>(
    tx,
    sql`select id, name, timezone, profile, settings->>'mgmt_source' as src, settings->>'mgmt_org_id' as org
      from admin.tenants where key = ${key} for no key update`,
  );
  return r ?? null;
}

/** Tenant KHÁC đang giữ marker org này (một org ⇒ một tenant). */
export async function orgTakenBy(tx: Tx, orgId: string, tenantId: string | null) {
  const [r] = await run<{ key: string }>(
    tx,
    sql`select key from admin.tenants where settings->>'mgmt_org_id' = ${orgId}
      and id is distinct from ${tenantId}::uuid limit 1`,
  );
  return r?.key ?? null;
}

export type NewTenant = {
  id: string;
  key: string;
  name: string;
  timezone: string;
  profile: unknown;
  settings: Record<string, unknown>;
};
/** Key đã có (đua) ⇒ không trả hàng. Trigger `tenants_beta_group` chạy như tạo tenant qua API. */
export async function insertTenant(tx: Tx, t: NewTenant, actorId: string): Promise<boolean> {
  const rows = await run<{ id: string }>(
    tx,
    sql`insert into admin.tenants (id, key, name, timezone, profile, settings, updated_by)
      values (${t.id}::uuid, ${t.key}, ${t.name}, ${t.timezone}, ${json(t.profile)}::jsonb,
        ${json(t.settings)}::jsonb, ${actorId}::uuid)
      on conflict (key) do nothing returning id`,
  );
  return rows.length === 1;
}

/** Ghi tên/múi giờ/hồ sơ + gộp marker vào settings (chỉ gọi khi có đổi); tăng version như PATCH. */
export async function updateTenant(
  tx: Tx,
  id: string,
  set: { name: string; timezone: string; profile: unknown; mark: Record<string, string> },
  actorId: string,
): Promise<void> {
  await run(
    tx,
    sql`update admin.tenants set name = ${set.name}, timezone = ${set.timezone},
        profile = ${json(set.profile)}::jsonb, settings = settings || ${json(set.mark)}::jsonb,
        version = version + 1, updated_at = now(), updated_by = ${actorId}::uuid
      where id = ${id}::uuid`,
  );
}

/** Group phòng ban: chèn mới hoặc đổi tên khi khác (không đổi ⇒ không ghi). Trả số hàng chèn/đổi. */
export async function upsertGroups(
  tx: Tx,
  tenantId: string,
  rows: readonly DeptRow[],
  actorId: string,
) {
  const [r] = await run<{ created: number; renamed: number }>(
    tx,
    sql`with up as (
        insert into admin.groups (tenant_id, key, name, updated_by)
        select ${tenantId}::uuid, x.key, x.name, ${actorId}::uuid
        from jsonb_to_recordset(${json(rows)}::jsonb) as x(key text, name jsonb)
        on conflict (tenant_id, key) do update
          set name = excluded.name, version = admin.groups.version + 1, updated_at = now(),
            updated_by = excluded.updated_by
          where admin.groups.name is distinct from excluded.name
        returning (xmax = 0) as created)
      select count(*) filter (where created)::int as created, count(*) filter (where not created)::int as renamed from up`,
  );
  return { created: r?.created ?? 0, renamed: r?.renamed ?? 0 };
}

/** Đánh dấu phòng ban + cha + thứ tự (khoá Group ⇒ id trong cùng câu); không đổi ⇒ không ghi. Trả số hàng chèn/đổi. */
export async function upsertDepartments(tx: Tx, tenantId: string, rows: readonly DeptRow[]) {
  const [r] = await run<{ n: number }>(
    tx,
    sql`with x as (select * from jsonb_to_recordset(${json(rows)}::jsonb) as x(key text, parent text, sort int)),
      g as (select id, key from admin.groups where tenant_id = ${tenantId}::uuid
        and key = any(array(select x.key from x))),
      up as (
        insert into admin.departments (tenant_id, group_id, parent_group_id, sort_order)
        select ${tenantId}::uuid, g.id, p.id, x.sort from x join g on g.key = x.key left join g p on p.key = x.parent
        on conflict (group_id) do update
          set parent_group_id = excluded.parent_group_id, sort_order = excluded.sort_order, updated_at = now()
          where admin.departments.parent_group_id is distinct from excluded.parent_group_id
             or admin.departments.sort_order is distinct from excluded.sort_order
        returning 1)
      select count(*)::int as n from up`,
  );
  return r?.n ?? 0;
}

/** Thành viên theo email (user đã có của tenant); email chưa có user ⇒ trả trong `pending` (chạy lại sau import). */
export async function addMembers(
  tx: Tx,
  tenantId: string,
  pairs: readonly { key: string; email: string }[],
  actorId: string,
) {
  const [r] = await run<{ added: number; pending: string[] }>(
    tx,
    sql`with x as (select * from jsonb_to_recordset(${json(pairs)}::jsonb) as x(key text, email text)),
      m as (select g.id as group_id, u.id as user_id, x.email from x
        join admin.groups g on g.tenant_id = ${tenantId}::uuid and g.key = x.key
        left join admin.users u on u.tenant_id = ${tenantId}::uuid and lower(u.email) = x.email),
      ins as (
        insert into admin.group_members (tenant_id, group_id, user_id, added_by)
        select ${tenantId}::uuid, m.group_id, m.user_id, ${actorId}::uuid from m where m.user_id is not null
        on conflict do nothing returning 1)
      select (select count(*)::int from ins) as added,
        coalesce((select array_agg(distinct m.email order by m.email) from m where m.user_id is null), '{}') as pending`,
  );
  return { added: r?.added ?? 0, pending: [...(r?.pending ?? [])] };
}

/** Trưởng phòng theo email (user đã có); khác hiện tại mới ghi. Trả số phòng đổi trưởng. */
export async function setHeads(
  tx: Tx,
  tenantId: string,
  heads: readonly { key: string; email: string }[],
) {
  const [r] = await run<{ n: number }>(
    tx,
    sql`with x as (select * from jsonb_to_recordset(${json(heads)}::jsonb) as x(key text, email text)),
      h as (select g.id as group_id, u.id as user_id from x
        join admin.groups g on g.tenant_id = ${tenantId}::uuid and g.key = x.key
        join admin.users u on u.tenant_id = ${tenantId}::uuid and lower(u.email) = x.email),
      up as (update admin.departments d set head_user_id = h.user_id, updated_at = now() from h
        where d.group_id = h.group_id and d.tenant_id = ${tenantId}::uuid
          and d.head_user_id is distinct from h.user_id returning 1)
      select count(*)::int as n from up`,
  );
  return r?.n ?? 0;
}
