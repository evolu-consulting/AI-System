// N5-FR-02, N5-FR-03, N5-FR-07 · N5-NFR-01 · SQL theo tập của công cụ chuyển user (plan N5 bảng câu). Mỗi hàm = MỘT câu văn
// bản cố định; dữ liệu lô qua MỘT tham số JSON (Luật 4c: chuẩn bị một lần mỗi kết nối, kế hoạch không phụ thuộc số hàng).
// Mọi câu ghi mang `tenant_id` tường minh; chạy dưới role `admin_api` scope platform (RLS bật).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
const json = (x: unknown): string => JSON.stringify(x);
const texts = (xs: readonly string[]) =>
  sql`array(select jsonb_array_elements_text(${json(xs)}::jsonb))`;
const uuids = (xs: readonly string[]) =>
  sql`array(select x::uuid from jsonb_array_elements_text(${json(xs)}::jsonb) as x)`;

export async function preflight(
  tx: Tx,
  actorId: string,
  featureKeys: readonly string[],
): Promise<{ actorOk: boolean; features: number }> {
  const [r] = await run<{ actor_ok: boolean; features: number }>(
    tx,
    sql`select exists (select 1 from admin.users u join admin.tenants t on t.id = u.tenant_id
        where u.id = ${actorId}::uuid and u.role = 'platform_admin' and u.active and not u.locked_by_tenant
          and t.active) as actor_ok,
      (select count(*)::int from admin.features where key = any(${texts(featureKeys)})) as features`,
  );
  return { actorOk: r?.actor_ok === true, features: r?.features ?? 0 };
}

export type TenantRow = {
  id: string;
  key: string;
  src: string | null;
  mgmt: string | null;
  active: boolean;
  pack_revoked: boolean;
};
/** Tenant theo marker org hoặc key; `pack_revoked` = có entitlement gói đã thu hồi (không bật lại — L2). */
export function findTenants(
  tx: Tx,
  q: { orgIds: readonly string[]; keys: readonly string[] },
  featureKeys: readonly string[],
) {
  return run<TenantRow>(
    tx,
    sql`select t.id, t.key, t.settings->>'mgmt_source' as src, t.settings->>'mgmt_org_id' as mgmt, t.active,
        exists (select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
          where e.tenant_id = t.id and e.revoked_at is not null and f.key = any(${texts(featureKeys)})) as pack_revoked
      from admin.tenants t
      where t.settings->>'mgmt_org_id' = any(${texts(q.orgIds)}) or t.key = any(${texts(q.keys)})`,
  );
}

export type NewTenant = { id: string; key: string; name: string; source: string; org_id: string };
/** Key đã có (đua) ⇒ không trả hàng ⇒ bên gọi báo ORG_KEY_TAKEN. */
export function insertTenants(tx: Tx, rows: readonly NewTenant[], actorId: string) {
  return run<{ id: string }>(
    tx,
    sql`insert into admin.tenants (id, key, name, settings, updated_by)
      select x.id, x.key, x.name, jsonb_build_object('mgmt_source', x.source, 'mgmt_org_id', x.org_id), ${actorId}::uuid
      from jsonb_to_recordset(${json(rows)}::jsonb) as x(id uuid, key text, name text, source text, org_id text)
      on conflict (key) do nothing
      returning id`,
  );
}

/** Entitlement 3 feature × N tenant MỚI tạo; đã có (kể cả đã thu hồi) ⇒ không đụng (L2). Trả tenant có đổi. */
export function enableEntitlements(
  tx: Tx,
  tenantIds: readonly string[],
  featureKeys: readonly string[],
  actorId: string,
) {
  return run<{ tenant_id: string }>(
    tx,
    sql`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
      select f.id, t.id, ${actorId}::uuid
      from admin.tenants t join admin.features f on f.key = any(${texts(featureKeys)})
      where t.id = any(${uuids(tenantIds)})
      on conflict (feature_id, tenant_id) do nothing
      returning tenant_id`,
  );
}

/** 3 Group vai × N tenant; trùng key ⇒ dùng lại. Trả tenant có Group mới. */
export function insertRoleGroups(
  tx: Tx,
  tenantIds: readonly string[],
  rows: readonly { key: string; name: unknown; description?: string }[],
  actorId: string,
) {
  return run<{ tenant_id: string }>(
    tx,
    sql`insert into admin.groups (tenant_id, key, name, description, updated_by)
      select t.id, x.key, x.name, x.description, ${actorId}::uuid
      from admin.tenants t cross join jsonb_to_recordset(${json(rows)}::jsonb) as x(key text, name jsonb, description text)
      where t.id = any(${uuids(tenantIds)})
      on conflict (tenant_id, key) do nothing
      returning tenant_id`,
  );
}

/** 6 grant (Group key → feature key) × N tenant; trùng ⇒ bỏ qua. Trả tenant có grant mới. */
export function insertRoleGrants(
  tx: Tx,
  tenantIds: readonly string[],
  pairs: readonly { grp: string; feat: string }[],
  actorId: string,
) {
  return run<{ tenant_id: string }>(
    tx,
    sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, granted_by)
      select gr.tenant_id, f.id, gr.id, ${actorId}::uuid
      from jsonb_to_recordset(${json(pairs)}::jsonb) as p(grp text, feat text)
      join admin.groups gr on gr.tenant_id = any(${uuids(tenantIds)}) and gr.key = p.grp
      join admin.features f on f.key = p.feat
      on conflict (tenant_id, feature_id, group_id) where group_id is not null do nothing
      returning tenant_id`,
  );
}

export function readGroups(tx: Tx, tenantIds: readonly string[], keys: readonly string[]) {
  return run<{ tenant_id: string; id: string; key: string }>(
    tx,
    sql`select tenant_id, id, key from admin.groups
      where tenant_id = any(${uuids(tenantIds)}) and key = any(${texts(keys)})`,
  );
}

/** Dry-run (review Trung 2): email (lower) mọi user của các tenant ⇒ báo USER_CONFLICT như apply. Lọc leakproof. */
export function tenantEmails(tx: Tx, tenantIds: readonly string[]) {
  return run<{ tenant_id: string; email: string }>(
    tx,
    sql`select tenant_id, lower(email) as email from admin.users
      where tenant_id = any(${uuids(tenantIds)}) and email is not null`,
  );
}

export type UserRow = {
  tenant_id: string;
  id: string;
  email: string | null;
  username: string;
  roles: string[];
};
/**
 * User khớp (tenant, username ứng viên = base/fallback của email) + Group vai gói đang thuộc; email so ở domain. CHỈ lọc bằng
 * phép bằng leakproof (uuid/text): dưới RLS, `lower(email) = any(..)` (lower không leakproof) không dùng được index ⇒ seq scan
 * (đo: 261 ms/lô với 10.000 user) — lọc theo `users_tenant_username_uq` còn ~1 ms. User tạo tay khác username ⇒ đụng
 * `users_tenant_email_uq` lúc chèn ⇒ USER_CONFLICT (spec §7).
 */
export function findUsers(
  tx: Tx,
  q: { tenantIds: readonly string[]; usernames: readonly string[] },
  groupKeys: readonly string[],
) {
  return run<UserRow>(
    tx,
    sql`select u.tenant_id, u.id, lower(u.email) as email, u.username,
        array(select g.key from admin.group_members m join admin.groups g on g.id = m.group_id
          where m.user_id = u.id and g.tenant_id = u.tenant_id and g.key = any(${texts(groupKeys)})) as roles
      from admin.users u
      where u.tenant_id = any(${uuids(q.tenantIds)})
        and u.username = any(${texts(q.usernames)})`,
  );
}

export type NewUser = {
  id: string;
  tenant_id: string;
  username: string;
  email: string;
  /** null ⇒ dùng hash không dùng được của lần chạy (buộc đặt lại). */
  hash: string | null;
  display_name: string;
  role: string;
  locale: string;
  must: boolean;
};
/** Trùng (email/username — đua) ⇒ không trả hàng. Hash chỉ nằm trong tham số, không bao giờ trong text/log. */
export function insertUsers(tx: Tx, rows: readonly NewUser[], resetHash: string, actorId: string) {
  return run<{ id: string }>(
    tx,
    sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale,
        must_change_password, updated_by)
      select x.id, x.tenant_id, x.username, x.email, coalesce(x.hash, ${resetHash}), x.display_name, x.role,
        x.locale, x.must, ${actorId}::uuid
      from jsonb_to_recordset(${json(rows)}::jsonb) as x(id uuid, tenant_id uuid, username text, email text,
        hash text, display_name text, role text, locale text, must boolean)
      on conflict do nothing
      returning id`,
  );
}

/** M1b · user + quản lý hiện có của các tenant (lọc `tenant_id = any` — leakproof, index `users_tenant_*`). */
export function tenantUsers(tx: Tx, tenantIds: readonly string[]) {
  return run<{
    tenant_id: string;
    id: string;
    email: string | null;
    username: string;
    manager_id: string | null;
  }>(
    tx,
    sql`select u.tenant_id, u.id, lower(u.email) as email, u.username, m.manager_id
      from admin.users u left join admin.user_managers m on m.user_id = u.id and m.tenant_id = u.tenant_id
      where u.tenant_id = any(${uuids(tenantIds)})`,
  );
}

/** M1b · đặt quản lý theo tập (1 câu); đã có quản lý (đua/đặt tay) ⇒ không đè (L2). Trigger DB duy trì closure + chặn vòng. */
export function insertManagers(
  tx: Tx,
  rows: readonly { tenant_id: string; user_id: string; manager_id: string }[],
  actorId: string,
) {
  return run<{ tenant_id: string; user_id: string; manager_id: string }>(
    tx,
    sql`insert into admin.user_managers (tenant_id, user_id, manager_id, updated_by)
      select x.tenant_id, x.user_id, x.manager_id, ${actorId}::uuid
      from jsonb_to_recordset(${json(rows)}::jsonb) as x(tenant_id uuid, user_id uuid, manager_id uuid)
      on conflict (user_id) do nothing
      returning tenant_id, user_id, manager_id`,
  );
}

export type NewMember = { tenant_id: string; group_id: string; user_id: string };
export function insertMembers(tx: Tx, rows: readonly NewMember[], actorId: string) {
  return run<{ tenant_id: string; user_id: string }>(
    tx,
    sql`insert into admin.group_members (tenant_id, group_id, user_id, added_by)
      select x.tenant_id, x.group_id, x.user_id, ${actorId}::uuid
      from jsonb_to_recordset(${json(rows)}::jsonb) as x(tenant_id uuid, group_id uuid, user_id uuid)
      on conflict do nothing
      returning tenant_id, user_id`,
  );
}
