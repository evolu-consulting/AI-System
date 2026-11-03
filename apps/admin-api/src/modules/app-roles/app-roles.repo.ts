// CR-112 · ADM-FR-80/81/82 · truy vấn `admin.app_roles` (RLS admin_rw: scope tenant chỉ thấy tenant mình). Mỗi thao tác một số
// câu cố định; dữ liệu lô qua một tham số JSON (Luật 4c).
import {
  APP_ROLES_MAX,
  type AppRoleLevel,
  DEFAULT_ROLE_LEVEL,
  PACK_ROLES,
  packGroupKey,
} from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type RoleRow = {
  id: string;
  tenant_id: string;
  pack: string;
  key: string;
  name: unknown;
  level: AppRoleLevel;
  group_id: string;
  is_default: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};
export type RoleListRow = RoleRow & { member_count: number; entitled: string[] | null };

const COLS = sql`r.id, r.tenant_id, r.pack, r.key, r.name, r.level, r.group_id, r.is_default, r.version,
  r.created_at, r.updated_at`;

/** Danh sách vai + số thành viên Group + mã gói đang có entitlement của tenant (trần) — một câu, ≤ APP_ROLES_MAX hàng. */
export function listRoles(
  tx: Tx,
  f: { tenantId: string | null; pack: string | null; id?: string },
): Promise<RoleListRow[]> {
  const id = f.id ?? null;
  return run<RoleListRow>(
    tx,
    sql`select ${COLS},
        (select count(*)::int from admin.group_members m where m.group_id = r.group_id) as member_count,
        (select array_agg(fe.key) from admin.feature_entitlements e join admin.features fe on fe.id = e.feature_id
          where e.tenant_id = r.tenant_id and e.revoked_at is null
            and fe.key in (replace(r.pack, '_', '-') || '-read', replace(r.pack, '_', '-') || '-write',
              replace(r.pack, '_', '-') || '-admin')) as entitled
      from admin.app_roles r
      where (${f.tenantId}::uuid is null or r.tenant_id = ${f.tenantId}::uuid)
        and (${f.pack}::text is null or r.pack = ${f.pack}::text)
        and (${id}::uuid is null or r.id = ${id}::uuid)
      order by r.tenant_id, r.pack, r.is_default desc, r.key
      limit ${APP_ROLES_MAX}`,
  );
}

/** Vai theo id, lọc tenant (null = platform); `lock` = FOR NO KEY UPDATE (đổi tên/mức/xoá) hoặc FOR SHARE (thành viên). */
export async function findRole(
  tx: Tx,
  tenantId: string | null,
  id: string,
  lock: "no key update" | "share",
): Promise<RoleRow | null> {
  const rows = await run<RoleRow>(
    tx,
    sql`select ${COLS} from admin.app_roles r
      where r.id = ${id} and (${tenantId}::uuid is null or r.tenant_id = ${tenantId}::uuid)
      for ${sql.raw(lock)}`,
  );
  return rows[0] ?? null;
}

export async function insertRole(
  tx: Tx,
  r: {
    tenantId: string;
    pack: string;
    key: string;
    name: unknown;
    level: AppRoleLevel;
    groupId: string;
  },
): Promise<string> {
  const [row] = await run<{ id: string }>(
    tx,
    sql`insert into admin.app_roles (tenant_id, pack, key, name, level, group_id)
      values (${r.tenantId}::uuid, ${r.pack}, ${r.key}, ${JSON.stringify(r.name)}::jsonb, ${r.level},
        ${r.groupId}::uuid)
      returning id`,
  );
  if (!row) throw new Error("app-roles: không chèn được vai");
  return row.id;
}

/** Đổi tên/mức + tăng version vai; đổi tên thì Group của vai đổi theo (cùng tên, version Group +1). */
export async function bumpRole(
  tx: Tx,
  r: { id: string; groupId: string; actorId: string },
  set: { name?: unknown; level?: AppRoleLevel },
): Promise<void> {
  const name = set.name === undefined ? null : JSON.stringify(set.name);
  await tx.execute(sql`update admin.app_roles set
      name = coalesce(${name}::jsonb, name), level = coalesce(${set.level ?? null}::text, level),
      version = version + 1, updated_at = now()
    where id = ${r.id}`);
  if (name !== null)
    await tx.execute(sql`update admin.groups set name = ${name}::jsonb, version = version + 1,
        updated_at = now(), updated_by = ${r.actorId}::uuid
      where id = ${r.groupId}`);
}

export async function memberCount(tx: Tx, groupId: string): Promise<number> {
  const [r] = await run<{ n: number }>(
    tx,
    sql`select count(*)::int as n from admin.group_members where group_id = ${groupId}`,
  );
  return r?.n ?? 0;
}

/** Xoá Group của vai ⇒ cascade vai + thành viên + grant. */
export async function deleteRoleGroup(
  tx: Tx,
  r: { tenantId: string; groupId: string },
): Promise<void> {
  await tx.execute(
    sql`delete from admin.groups where tenant_id = ${r.tenantId} and id = ${r.groupId}`,
  );
}

/** Vai mặc định của gói từ 3 Group vai `<k'>-viewer|editor|owner` (đã có) — trùng ⇒ bỏ qua. Trả số vai mới. */
export function insertDefaultRoles(tx: Tx, tenantId: string, pack: string): Promise<number> {
  return insertDefaultRolesFor(tx, [tenantId], pack);
}

/** Như `insertDefaultRoles` cho nhiều tenant một câu (importer — S6). */
export async function insertDefaultRolesFor(
  tx: Tx,
  tenantIds: readonly string[],
  pack: string,
): Promise<number> {
  if (tenantIds.length === 0) return 0;
  const tids = `{${tenantIds.join(",")}}`;
  const rows = PACK_ROLES.map((r) => ({
    gk: packGroupKey(pack, r),
    key: r,
    level: DEFAULT_ROLE_LEVEL[r],
  }));
  const out = await run<{ id: string }>(
    tx,
    sql`insert into admin.app_roles (tenant_id, pack, key, name, level, group_id, is_default)
      select g.tenant_id, ${pack}, x.key, g.name, x.level, g.id, true
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(gk text, key text, level text)
      join admin.groups g on g.tenant_id = any(${tids}::uuid[]) and g.key = x.gk
      on conflict do nothing
      returning id`,
  );
  return out.length;
}

/** Tenant được tạo vai cho gói này: tenant tồn tại (404) — trả false nếu không. */
export async function tenantExists(tx: Tx, id: string): Promise<boolean> {
  return (
    (await run<{ id: string }>(tx, sql`select id from admin.tenants where id = ${id}`)).length > 0
  );
}

/** Gói đã cài ⇔ có đủ 3 feature `<k'>-read|write|admin`. */
export async function packInstalled(tx: Tx, keys: readonly string[]): Promise<boolean> {
  const [r] = await run<{ n: number }>(
    tx,
    sql`select count(*)::int as n from admin.features where key = any(${`{${keys.join(",")}}`}::text[])`,
  );
  return r?.n === keys.length;
}
