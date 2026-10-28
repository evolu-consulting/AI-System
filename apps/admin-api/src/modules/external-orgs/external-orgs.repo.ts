// CR-102a · ADM-FR-75 · truy vấn `admin.external_orgs`. Luôn trong withScope (RLS) và lọc tenant_id tường minh khi có.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";

export type OrgRow = {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  created_at: Date | string;
  created_by: string | null;
  updated_at: Date | string;
  user_count: number;
  active_user_count: number;
};

/** Đếm user theo công ty bằng subquery trên index `users_external_org_idx` (chỉ hàng của trang). */
const cols = sql`o.id, o.tenant_id, o.name, o.active, o.created_at, o.updated_at,
  (select w.username from admin.users w where w.id = o.created_by) as created_by,
  (select count(*)::int from admin.users u where u.tenant_id = o.tenant_id and u.external_org_id = o.id) as user_count,
  (select count(*)::int from admin.users u where u.tenant_id = o.tenant_id and u.external_org_id = o.id
     and u.active and u.deactivated_at is null) as active_user_count`;

export type OrgFilter = {
  tenantId: string | null;
  q?: string;
  status?: "active" | "inactive";
  limit: number;
  offset: number;
};

export async function listOrgs(tx: Tx, f: OrgFilter): Promise<(OrgRow & { total: number })[]> {
  const like = f.q ? likeArg(f.q) : null;
  const active = f.status ? f.status === "active" : null;
  return (await tx.execute(sql`with page as (
      select o.*, count(*) over()::int as total from admin.external_orgs o
      where (${f.tenantId}::uuid is null or o.tenant_id = ${f.tenantId}::uuid)
        and (${like}::text is null or o.name ilike ${like})
        and (${active}::boolean is null or o.active = ${active}::boolean)
      order by lower(o.name), o.id limit ${f.limit} offset ${f.offset})
    select ${cols}, o.total from page o order by lower(o.name), o.id`)) as unknown as (OrgRow & {
    total: number;
  })[];
}

/** `tenantId` null = mọi tenant (chỉ scope platform; RLS vẫn áp). `lock`: khoá hàng org trong transaction ghi. */
export async function findOrg(
  tx: Tx,
  tenantId: string | null,
  id: string,
  lock?: "share" | "no key update",
): Promise<OrgRow | null> {
  const forClause = lock === "share" ? sql`for share` : lock ? sql`for no key update` : sql``;
  const base = (await tx.execute(sql`select o.id from admin.external_orgs o
    where o.id = ${id} and (${tenantId}::uuid is null or o.tenant_id = ${tenantId}::uuid) ${forClause}`)) as unknown as {
    id: string;
  }[];
  if (base.length === 0) return null;
  const [row] = (await tx.execute(
    sql`select ${cols} from admin.external_orgs o where o.id = ${id}`,
  )) as unknown as OrgRow[];
  return row ?? null;
}

/** com-c2 · tenant có `key='platform'` (tenant nhà vận hành). Tenant lạ ⇒ false (insert sau đó trả 404 qua FK). */
export async function isPlatformTenant(tx: Tx, tenantId: string): Promise<boolean> {
  const r = (await tx.execute(
    sql`select 1 as x from admin.tenants where id = ${tenantId}::uuid and key = 'platform'`,
  )) as unknown as { x: number }[];
  return r.length > 0;
}

export async function insertOrg(
  tx: Tx,
  o: { tenantId: string; name: string; by: string },
): Promise<string> {
  const id = Bun.randomUUIDv7();
  await tx.execute(sql`insert into admin.external_orgs (id, tenant_id, name, created_by)
    values (${id}, ${o.tenantId}, ${o.name}, ${o.by})`);
  return id;
}

export async function updateOrg(
  tx: Tx,
  o: { tenantId: string; id: string },
  set: { name?: string; active?: boolean },
): Promise<void> {
  await tx.execute(sql`update admin.external_orgs set
      name = coalesce(${set.name ?? null}::text, name),
      active = coalesce(${set.active ?? null}::boolean, active),
      updated_at = now()
    where tenant_id = ${o.tenantId} and id = ${o.id}`);
}
