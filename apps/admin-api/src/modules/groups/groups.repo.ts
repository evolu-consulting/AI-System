// ADM-FR-62, ADM-FR-55, ADM-NFR-07 · truy vấn groups (luôn trong withScope/configWrite → RLS, và lọc tenant_id tường minh).
// Khoá: chỉ FOR NO KEY UPDATE (PATCH/DELETE) và FOR SHARE (thành viên, grant) — hạng 3 của thứ tự toàn cục (plan M3 §6).
import { BETA_GROUP_KEY } from "@ai/contracts";
import { groups, type Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";

export type GroupRow = {
  id: string;
  tenantId: string;
  tenantKey: string;
  tenantName: string;
  key: string;
  name: unknown;
  description: string | null;
  memberCount: number;
  featureCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

const cols = sql`g.id, g.tenant_id as "tenantId", t.key as "tenantKey", t.name as "tenantName", g.key, g.name,
  g.description, g.version, g.created_at as "createdAt", g.updated_at as "updatedAt",
  (select count(*)::int from admin.group_members m where m.group_id = g.id) as "memberCount",
  (select count(*)::int from admin.feature_grants fg where fg.group_id = g.id) as "featureCount",
  (select u.username from admin.users u where u.id = g.updated_by) as "updatedBy"`;

const betaFirst = sql`(g.key <> ${BETA_GROUP_KEY}), g.key`;

function toRow(r: Record<string, unknown>): GroupRow {
  return {
    ...(r as unknown as GroupRow),
    createdAt: new Date(r.createdAt as string),
    updatedAt: new Date(r.updatedAt as string),
  };
}

export type GroupFilter = { tenantId: string | null; q?: string; limit: number; offset: number };

/** Sắp tenant_key, `beta-testers` đầu, rồi key (M3-R23); `q` khớp key, name.vi, name.en. */
export async function listGroups(
  tx: Tx,
  f: GroupFilter,
): Promise<{ rows: GroupRow[]; total: number }> {
  const like = f.q ? likeArg(f.q) : null;
  const rows = (await tx.execute(sql`
    select ${cols}, count(*) over()::int as total
    from admin.groups g join admin.tenants t on t.id = g.tenant_id
    where (${f.tenantId}::uuid is null or g.tenant_id = ${f.tenantId})
      and (${like}::text is null or g.key ilike ${like} or g.name->>'vi' ilike ${like}
           or g.name->>'en' ilike ${like})
    order by t.key, ${betaFirst}
    limit ${f.limit} offset ${f.offset}`)) as unknown as Record<string, unknown>[];
  return { rows: rows.map(toRow), total: Number(rows[0]?.total ?? 0) };
}

/** `tenantId` null = mọi tenant (platform). Không khoá. */
export async function findGroup(
  tx: Tx,
  tenantId: string | null,
  id: string,
): Promise<GroupRow | null> {
  const rows = (await tx.execute(sql`
    select ${cols} from admin.groups g join admin.tenants t on t.id = g.tenant_id
    where g.id = ${id} and (${tenantId}::uuid is null or g.tenant_id = ${tenantId})`)) as unknown as Record<
    string,
    unknown
  >[];
  return rows[0] ? toRow(rows[0]) : null;
}

/** Khoá một group; trả `{id, tenantId, key}` hoặc null. `no key update` = sắp ghi/xoá; `share` = giữ không bị xoá. */
export async function lockGroup(
  tx: Tx,
  tenantId: string | null,
  id: string,
  mode: "no key update" | "share",
): Promise<{ id: string; tenantId: string; key: string } | null> {
  const rows = (await tx.execute(sql`
    select id, tenant_id as "tenantId", key from admin.groups
    where id = ${id} and (${tenantId}::uuid is null or tenant_id = ${tenantId})
    for ${sql.raw(mode)}`)) as unknown as { id: string; tenantId: string; key: string }[];
  return rows[0] ?? null;
}

export type NewGroup = {
  id: string;
  tenantId: string;
  key: string;
  name: { vi: string; en?: string };
  description: string | null;
  actorId: string;
  /** Vắng = mặc định 1; khôi phục bản đã xoá đặt bản cuối + 1. */
  version?: number;
};

/** 23505 `groups_tenant_key_uq` do service dịch thành KEY_TAKEN. */
export async function insertGroup(tx: Tx, g: NewGroup): Promise<void> {
  await tx.insert(groups).values({
    id: g.id,
    tenantId: g.tenantId,
    key: g.key,
    name: g.name,
    description: g.description,
    version: g.version,
    updatedBy: g.actorId,
  });
}

export type GroupSet = Partial<{ name: { vi: string; en?: string }; description: string | null }>;

export async function bumpGroup(
  tx: Tx,
  g: { tenantId: string; id: string },
  set: GroupSet,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update admin.groups set
      name = coalesce(${set.name === undefined ? null : JSON.stringify(set.name)}::jsonb, name),
      description = case when ${"description" in set} then ${set.description ?? null} else description end,
      version = version + 1, updated_at = now(), updated_by = ${actorId}
    where tenant_id = ${g.tenantId} and id = ${g.id}`);
}

export async function deleteGroup(tx: Tx, g: { tenantId: string; id: string }): Promise<void> {
  await tx.execute(sql`delete from admin.groups where tenant_id = ${g.tenantId} and id = ${g.id}`);
}

/** Không khoá (FK `KEY SHARE` khi chèn đủ giữ tenant; app không xoá tenant — ngoại lệ E2, plan §6). */
export async function tenantExists(tx: Tx, id: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`select 1 from admin.tenants where id = ${id}`,
  )) as unknown as unknown[];
  return rows.length === 1;
}
