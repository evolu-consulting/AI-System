// arch-a10 · kit đọc hộ gói các bảng `admin.*` / `hub.*` (role gói không đọc — pack-boundary D-06): gói KHÔNG import `hub-scope`,
// chỉ gọi các hàm dưới đây qua `kit/public.ts`. Mỗi hàm MỘT câu văn bản hằng, `tenant_id` tường minh (Luật 4c), không theo hàng.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { PackWho } from "../application/ports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr = (xs: readonly string[]) => `{${xs.join(",")}}`;
const SYSTEM = { kind: "system" } as const;
const userScope = (w: PackWho) =>
  ({ kind: "user", tenantId: w.tenantId, userId: w.userId }) as const;

/** Cờ `hub.tenant_flow_settings.flow_triggers` của công ty. */
export async function tenantFlowTriggersOn(db: Db, tenantId: string): Promise<boolean> {
  const [r] = await withHubScope(db, SYSTEM, (tx) =>
    tx.execute<{ on: boolean }>(
      sql`select exists (select 1 from hub.tenant_flow_settings
        where tenant_id = ${tenantId}::uuid and flow_triggers) as on`,
    ),
  );
  return r?.on === true;
}

/** Câu phòng ban (mã Group) của user + phòng cha (xuất cho test đếm). */
export const CREATOR_DEPARTMENTS_SQL = (tenantId: string, userId: string) => sql`
  with recursive anc(id) as (
    select m.group_id from admin.group_members m
      join admin.departments dp on dp.group_id = m.group_id and dp.tenant_id = m.tenant_id
    where m.tenant_id = ${tenantId}::uuid and m.user_id = ${userId}::uuid
    union
    select dp.parent_group_id from anc join admin.departments dp on dp.group_id = anc.id
    where dp.tenant_id = ${tenantId}::uuid and dp.parent_group_id is not null)
  select coalesce(array_agg(g.key order by g.key), '{}') as keys
  from anc join admin.groups g on g.id = anc.id and g.tenant_id = ${tenantId}::uuid`;

/** Mã Group phòng ban của user + mọi phòng cha (CTE đệ quy); id sai dạng ⇒ []. */
export function creatorDepartmentsOf(db: Db) {
  return async (tenantId: string, userId: string): Promise<string[]> => {
    if (!UUID.test(tenantId) || !UUID.test(userId)) return [];
    const [r] = await withHubScope(db, SYSTEM, (tx) =>
      tx.execute<{ keys: string[] | null }>(CREATOR_DEPARTMENTS_SQL(tenantId, userId)),
    );
    return r?.keys ?? [];
  };
}

/** Trưởng phòng của Group (cùng tenant); không phòng/không trưởng ⇒ null. */
export const deptHeadOf =
  (db: Db) =>
  async (tenantId: string, groupId: string): Promise<string | null> => {
    const rows = await withHubScope(db, SYSTEM, (tx) =>
      tx.execute<{ h: string | null }>(sql`select d.head_user_id as h from admin.departments d
        where d.tenant_id = ${tenantId}::uuid and d.group_id = ${groupId}::uuid limit 1`),
    );
    return rows[0]?.h ?? null;
  };

/** User còn dùng được của tenant (active, không bị khoá). */
export const activeUserOf =
  (db: Db) =>
  async (tenantId: string, userId: string): Promise<boolean> => {
    const rows = await withHubScope(db, SYSTEM, (tx) =>
      tx.execute<{ id: string }>(sql`select id from admin.users
        where tenant_id = ${tenantId}::uuid and id = ${userId}::uuid and active and not locked_by_tenant`),
    );
    return rows.length === 1;
  };

/** Người trong `ids` là thành viên tenant còn dùng được VÀ thuộc một trong `groups` (MỘT câu; scope user của người gọi). */
export async function activeMembersAmong(
  db: Db,
  who: PackWho,
  ids: readonly string[],
  groups: readonly string[],
): Promise<ReadonlySet<string>> {
  const rows = await withHubScope(db, userScope(who), (tx) =>
    tx.execute<{ id: string }>(sql`select u.id from admin.users u
        where u.tenant_id = ${who.tenantId}::uuid and u.active and not u.locked_by_tenant
          and u.id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::uuid[])
          and exists (select 1 from admin.group_members gm where gm.tenant_id = u.tenant_id and gm.user_id = u.id
            and gm.group_id = any(array(select jsonb_array_elements_text(${JSON.stringify(groups)}::jsonb))::uuid[]))`),
  );
  return new Set(rows.map((r) => r.id));
}

/** Thành viên NỘI BỘ còn dùng được thuộc một trong `groups` (tuỳ chọn chỉ một `only`), xếp theo tên, ≤ `limit`. */
export async function internalMembersOfGroups(
  db: Db,
  who: PackWho,
  groups: readonly string[],
  only: string | undefined,
  limit: number,
): Promise<{ id: string; name: string }[]> {
  const rows = await withHubScope(db, userScope(who), (tx) =>
    tx.execute<{
      id: string;
      name: string;
    }>(sql`select u.id, u.display_name as name from admin.users u
        where u.tenant_id = ${who.tenantId}::uuid and u.active and not u.locked_by_tenant and u.kind = 'internal'
          and (${only ?? null}::uuid is null or u.id = ${only ?? null}::uuid)
          and exists (select 1 from admin.group_members gm where gm.tenant_id = u.tenant_id and gm.user_id = u.id
            and gm.group_id = any(array(select jsonb_array_elements_text(${JSON.stringify(groups)}::jsonb))::uuid[]))
        order by lower(u.display_name), u.id limit ${limit}::int`),
  );
  return rows.map((x) => ({ id: x.id, name: x.name }));
}

/** Người nhận chuyển cấp theo Group (cùng tenant): trưởng phòng còn dùng được; không có ⇒ thành viên còn dùng được (≤ `max`). MỘT câu cho cả lô. */
export const escalateTargetsOf =
  (db: Db) =>
  async (
    tenantId: string,
    groupIds: readonly string[],
    max: number,
  ): Promise<Map<string, string[]>> => {
    const out = new Map<string, string[]>();
    if (groupIds.length === 0) return out;
    const rows = await withHubScope(db, SYSTEM, (tx) =>
      tx.execute<{ g: string; users: string[] | null }>(sql`
        select g.id::text as g, coalesce(
          (select array[u.id::text] from admin.departments dp join admin.users u on u.id = dp.head_user_id
             and u.tenant_id = dp.tenant_id and u.active and not u.locked_by_tenant
           where dp.tenant_id = g.tenant_id and dp.group_id = g.id limit 1),
          array(select u.id::text from admin.group_members gm join admin.users u on u.id = gm.user_id
              and u.tenant_id = gm.tenant_id and u.active and not u.locked_by_tenant
            where gm.tenant_id = g.tenant_id and gm.group_id = g.id order by u.id limit ${max}::int)) as users
        from admin.groups g
        where g.tenant_id = ${tenantId}::uuid
          and g.id = any(array(select jsonb_array_elements_text(${JSON.stringify(groupIds)}::jsonb))::uuid[])`),
    );
    for (const r of rows) out.set(r.g, r.users ?? []);
    return out;
  };

/** Group của công ty (id, khoá, tên hiển thị) xếp theo tên, ≤ `limit`. */
export async function companyGroups(
  db: Db,
  tenantId: string,
  limit: number,
): Promise<{ id: string; key: string; name: string }[]> {
  const rows = await withHubScope(db, SYSTEM, (tx) =>
    tx.execute<{ id: string; key: string; name: string }>(sql`
          select g.id::text as id, g.key,
            case when jsonb_typeof(g.name) = 'string' then g.name #>> '{}'
              else coalesce(g.name ->> 'vi', g.name ->> 'en', g.key) end as name
          from admin.groups g where g.tenant_id = ${tenantId}::uuid order by 3, g.key limit ${limit}`),
  );
  return [...rows];
}

export type DirectoryRow = { k: string; id: string; g: string | null };
/** Một câu: người cụ thể (còn dùng được) + Group của công ty + thành viên còn dùng được của các Group đó (id đã kiểm dạng UUID). */
export async function directoryRows(
  db: Db,
  tenantId: string,
  users: readonly string[],
  groups: readonly string[],
): Promise<DirectoryRow[]> {
  const rows = await withHubScope(db, SYSTEM, (tx) =>
    tx.execute<DirectoryRow>(sql`
          select 'user' as k, u.id::text as id, null::text as g from admin.users u
            where u.tenant_id = ${tenantId}::uuid and u.id = any(${arr(users)}::uuid[])
              and u.active and not u.locked_by_tenant
          union all
          select 'group', g.id::text, null from admin.groups g
            where g.tenant_id = ${tenantId}::uuid and g.id = any(${arr(groups)}::uuid[])
          union all
          select 'member', m.user_id::text, m.group_id::text from admin.group_members m
            join admin.users u on u.id = m.user_id and u.tenant_id = m.tenant_id
            where m.tenant_id = ${tenantId}::uuid and m.group_id = any(${arr(groups)}::uuid[])
              and u.active and not u.locked_by_tenant`),
  );
  return [...rows];
}
