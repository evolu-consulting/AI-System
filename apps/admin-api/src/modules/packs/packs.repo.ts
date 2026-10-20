// PK-FR-05 · D-05 · N1 plan §5 "Bật gói": truy vấn bật/tắt gói theo tenant (scope platform, RLS). Mỗi bước MỘT câu cố định,
// tập hợp qua `= any($array)` / một tham số JSON (Luật 4c) — số câu không phụ thuộc số feature/Group.
import { HUB_CONFIG_CHANNEL, HUB_CONTRACT_VERSION } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
const uuids = (xs: readonly string[]) => sql`${`{${xs.join(",")}}`}::uuid[]`;
const texts = (xs: readonly string[]) => sql`${`{${xs.join(",")}}`}::text[]`;

export type PackFeature = { id: string; key: string };
export type PackGroupRow = { id: string; key: string };
export type PackListRow = { key: string; enabled: boolean; groups: PackGroupRow[] };

export async function tenantExists(tx: Tx, id: string): Promise<boolean> {
  const r = await run<{ id: string }>(tx, sql`select id from admin.tenants where id = ${id}`);
  return r.length > 0;
}

/** 3 feature của gói, khoá `FOR KEY SHARE` theo `id` (thứ tự cố định, chặn xoá feature song song). */
export function lockPackFeatures(tx: Tx, keys: readonly string[]): Promise<PackFeature[]> {
  return run<PackFeature>(
    tx,
    sql`select id, key from admin.features where key = any(${texts(keys)})
      order by id for key share`,
  );
}

/** Upsert entitlement: chưa có ⇒ chèn; đã thu hồi ⇒ bật lại. Trả số hàng đổi (0 = đã bật). */
export async function enableEntitlements(
  tx: Tx,
  e: { tenantId: string; featureIds: readonly string[]; actorId: string },
): Promise<number> {
  const rows = await run<{ feature_id: string }>(
    tx,
    sql`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
      select f, ${e.tenantId}::uuid, ${e.actorId}::uuid from unnest(${uuids(e.featureIds)}) as f
      on conflict (feature_id, tenant_id) do update
        set revoked_at = null, granted_by = excluded.granted_by, granted_at = now()
        where admin.feature_entitlements.revoked_at is not null
      returning feature_id`,
  );
  return rows.length;
}

/** Thu hồi (đặt `revoked_at`, giữ hàng); đã thu hồi ⇒ không ghi. Trả số hàng đổi. */
export async function revokeEntitlements(
  tx: Tx,
  e: { tenantId: string; featureIds: readonly string[] },
): Promise<number> {
  const rows = await run<{ feature_id: string }>(
    tx,
    sql`update admin.feature_entitlements set revoked_at = now()
      where tenant_id = ${e.tenantId} and feature_id = any(${uuids(e.featureIds)})
        and revoked_at is null
      returning feature_id`,
  );
  return rows.length;
}

/** 3 Group vai; trùng key (kể cả Group tenant tự tạo — readiness #16) ⇒ dùng lại. Trả số Group mới. */
export async function insertRoleGroups(
  tx: Tx,
  g: { tenantId: string; actorId: string; rows: readonly { key: string; name: unknown }[] },
): Promise<number> {
  const rows = await run<{ id: string }>(
    tx,
    sql`insert into admin.groups (tenant_id, key, name, updated_by)
      select ${g.tenantId}::uuid, x.key, x.name, ${g.actorId}::uuid
      from jsonb_to_recordset(${JSON.stringify(g.rows)}::jsonb) as x(key text, name jsonb)
      on conflict (tenant_id, key) do nothing
      returning id`,
  );
  return rows.length;
}

/** Grant theo cặp (Group key → feature key) — một câu join; trùng ⇒ bỏ qua. Trả số grant mới. */
export async function insertRoleGrants(
  tx: Tx,
  g: { tenantId: string; actorId: string; pairs: readonly { grp: string; feat: string }[] },
): Promise<number> {
  const rows = await run<{ id: string }>(
    tx,
    sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, granted_by)
      select ${g.tenantId}::uuid, f.id, gr.id, ${g.actorId}::uuid
      from jsonb_to_recordset(${JSON.stringify(g.pairs)}::jsonb) as p(grp text, feat text)
      join admin.groups gr on gr.tenant_id = ${g.tenantId}::uuid and gr.key = p.grp
      join admin.features f on f.key = p.feat
      on conflict (tenant_id, feature_id, group_id) where group_id is not null do nothing
      returning id`,
  );
  return rows.length;
}

/**
 * UAT B4 · trợ lý AI của gói (`packs.pack_agents`): entitlement + grant 3 Group vai cho tenant — hàm SECURITY DEFINER
 * (`migrations-packs/0005`), cùng tx bật gói. Có đổi ⇒ đã khoá + bump `hub.config_meta`, trả version mới để NOTIFY
 * `hub_config_changed` trong tx (giao khi commit); không đổi ⇒ null.
 */
export async function grantPackAgents(
  tx: Tx,
  g: { tenantIds: readonly string[]; key: string; actorId: string },
): Promise<number | null> {
  if (g.tenantIds.length === 0) return null;
  const [r] = await run<{ v: string | number | null }>(
    tx,
    sql`select packs.grant_agents(${g.key}, ${uuids(g.tenantIds)}, ${g.actorId}::uuid) as v`,
  );
  return r?.v == null ? null : Number(r.v);
}

export async function notifyHubConfig(tx: Tx, version: number): Promise<void> {
  await tx.execute(
    sql`select pg_notify(${HUB_CONFIG_CHANNEL}, ${JSON.stringify({ v: HUB_CONTRACT_VERSION, version })})`,
  );
}

export function findGroups(
  tx: Tx,
  tenantId: string,
  keys: readonly string[],
): Promise<PackGroupRow[]> {
  return run<PackGroupRow>(
    tx,
    sql`select id, key from admin.groups where tenant_id = ${tenantId} and key = any(${texts(keys)})
      order by key`,
  );
}

/** Danh sách gói đã cài (`packs.registry`) + trạng thái của tenant — một câu, ≤ `limit` hàng. */
export function listPacks(tx: Tx, tenantId: string, limit: number): Promise<PackListRow[]> {
  return run<PackListRow>(
    tx,
    sql`select r.key,
        exists (select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
          where e.tenant_id = ${tenantId} and e.revoked_at is null
            and f.key = replace(r.key, '_', '-') || '-read') as enabled,
        coalesce((select json_agg(json_build_object('id', g.id, 'key', g.key) order by g.key)
          from admin.groups g where g.tenant_id = ${tenantId}
            and g.key = any (array[replace(r.key, '_', '-') || '-owner', replace(r.key, '_', '-') || '-editor',
              replace(r.key, '_', '-') || '-viewer'])), '[]'::json) as groups
      from packs.registry r order by r.key limit ${limit}`,
  );
}
