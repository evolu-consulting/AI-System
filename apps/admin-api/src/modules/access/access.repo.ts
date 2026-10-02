// ADM-FR-36, ADM-BR-11, ADM-FR-24 · đọc dữ liệu tính hiệu lực (spec M3 §3, plan §3.2, §5.6). Chỉ đọc, không khoá;
// luôn trong withScope (RLS) và lọc tenant tường minh. Không N+1: mỗi hàm một câu.
import { CORE_FEATURE_KEY, type FeatureStatus } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type UserHead = {
  id: string;
  username: string;
  display_name: string;
  tenant_id: string;
  tenant_key: string;
  active: boolean;
  locked_by_tenant: boolean;
  tenant_active: boolean;
};

export async function userHead(
  tx: Tx,
  tenantId: string | null,
  id: string,
): Promise<UserHead | null> {
  const rows = await run<UserHead>(
    tx,
    sql`select u.id, u.username, u.display_name, u.tenant_id,
      t.key as tenant_key, u.active, u.locked_by_tenant, t.active as tenant_active
    from admin.users u join admin.tenants t on t.id = u.tenant_id
    where u.id = ${id} and (${tenantId}::uuid is null or u.tenant_id = ${tenantId})`,
  );
  return rows[0] ?? null;
}

export type GroupLite = { id: string; key: string; name: unknown };

/** Mọi group của user (beta đầu rồi key) — đủ để tính, không cắt. */
export async function userGroups(
  tx: Tx,
  u: { id: string; tenant_id: string },
): Promise<GroupLite[]> {
  return run(
    tx,
    sql`select g.id, g.key, g.name from admin.group_members m join admin.groups g on g.id = m.group_id
    where m.user_id = ${u.id} and m.tenant_id = ${u.tenant_id} order by (g.key <> 'beta-testers'), g.key`,
  );
}

export async function betaGroupId(tx: Tx, tenantId: string): Promise<string | null> {
  const rows = await run<{ id: string }>(
    tx,
    sql`select id from admin.groups
    where tenant_id = ${tenantId} and key = 'beta-testers'`,
  );
  return rows[0]?.id ?? null;
}

export type FeatureLite = {
  id: string;
  key: string;
  name: unknown;
  status: FeatureStatus;
  entitled: boolean;
  grant_group_ids: string[];
  grant_user: boolean;
};

/** Mọi feature (core đầu rồi key) + entitlement chưa thu hồi + group CỦA USER được cấp (beta đầu rồi key) + grant trực tiếp. */
export async function featuresFor(
  tx: Tx,
  u: { id: string; tenant_id: string },
): Promise<FeatureLite[]> {
  // Tập hợp trước rồi join (không subquery từng feature): đo 200 feature × 100 grant = 246 ms → vài ms. Chỉ lấy grant
  // của group MÀ USER THUỘC — `computeEffectiveAccess` chỉ dùng phần giao với `user.groupIds`.
  return run(
    tx,
    sql`with mine as (select m.group_id from admin.group_members m where m.user_id = ${u.id}),
      gg as (select fg.feature_id, array_agg(fg.group_id::text order by (g.key <> 'beta-testers'), g.key) as ids
        from admin.feature_grants fg join admin.groups g on g.id = fg.group_id
        where fg.tenant_id = ${u.tenant_id} and fg.group_id in (select group_id from mine)
        group by fg.feature_id),
      ug as (select distinct fg.feature_id from admin.feature_grants fg
        where fg.tenant_id = ${u.tenant_id} and fg.user_id = ${u.id}),
      en as (select e.feature_id from admin.feature_entitlements e
        where e.tenant_id = ${u.tenant_id} and e.revoked_at is null)
    select f.id, f.key, f.name, f.status, (en.feature_id is not null) as entitled,
      coalesce(gg.ids, '{}') as grant_group_ids, (ug.feature_id is not null) as grant_user
    from admin.features f
    left join gg on gg.feature_id = f.id
    left join ug on ug.feature_id = f.id
    left join en on en.feature_id = f.id
    order by (f.key <> ${CORE_FEATURE_KEY}), f.key`,
  );
}

export type CommandLite = {
  id: string;
  name: string;
  aliases: string[];
  description: unknown;
  enabled: boolean;
  workflow_enabled: boolean;
  feature_ids: string[];
  total: number;
};

/** Mọi command (sắp name, ≤ limit) hoặc chỉ command khớp name/alias; `total` = tổng trước khi cắt. */
export async function commandsFor(
  tx: Tx,
  o: { command?: string; limit: number },
): Promise<CommandLite[]> {
  const c = o.command ?? null;
  return run(
    tx,
    sql`select c.id, c.name, c.aliases, c.description, c.enabled, w.enabled as workflow_enabled,
      array(select fc.feature_id::text from admin.feature_commands fc where fc.command_id = c.id) as feature_ids,
      count(*) over()::int as total
    from admin.commands c join admin.workflows w on w.id = c.workflow_id
    where ${c}::text is null or c.name = ${c} or ${c} = any(c.aliases)
    order by c.name limit ${o.limit}`,
  );
}

/** `visible_user_count` theo tenant — cùng điều kiện SQL tham chiếu Hub (plan §3.2), `count(distinct u.id)`. */
export async function visibleUserCounts(
  tx: Tx,
  commandId: string,
  tenantIds: readonly string[],
): Promise<Map<string, number>> {
  if (tenantIds.length === 0) return new Map();
  if (await viaActiveCore(tx, commandId)) return activeUserCounts(tx, tenantIds);
  const rows = await run<{ tenant_id: string; n: number }>(
    tx,
    sql`
    select u.tenant_id, count(distinct u.id)::int as n
    from admin.users u
    join admin.tenants t on t.id = u.tenant_id and t.active
    join admin.commands c on c.id = ${commandId} and c.enabled
    join admin.workflows w on w.id = c.workflow_id and w.enabled
    join admin.feature_commands fc on fc.command_id = c.id
    join admin.features f on f.id = fc.feature_id
    where u.tenant_id = any(${pgArray(tenantIds, "uuid")}) and u.active and not u.locked_by_tenant
      and (f.status = 'on' or (f.status = 'beta' and exists (
            select 1 from admin.group_members m join admin.groups g on g.id = m.group_id
            where m.user_id = u.id and g.tenant_id = u.tenant_id and g.key = 'beta-testers')))
      and (f.key = ${CORE_FEATURE_KEY} or (
            exists (select 1 from admin.feature_entitlements e
                    where e.feature_id = f.id and e.tenant_id = u.tenant_id and e.revoked_at is null)
            and exists (select 1 from admin.feature_grants fg
                    where fg.feature_id = f.id and fg.tenant_id = u.tenant_id
                      and (fg.user_id = u.id or fg.group_id in (
                           select m.group_id from admin.group_members m where m.user_id = u.id)))))
    group by u.tenant_id`,
  );
  return new Map(rows.map((r) => [r.tenant_id, r.n]));
}

export type GroupPairRow = {
  tenant_id: string;
  g_id: string;
  g_key: string;
  g_name: unknown;
  f_id: string;
  f_key: string;
  f_name: unknown;
  total: number;
};

/** Cặp (group, feature của command) đang được cấp, feature on|beta có entitlement chưa thu hồi; ≤ `max` mỗi tenant. */
export async function groupPairs(
  tx: Tx,
  commandId: string,
  o: { tenantIds: readonly string[]; max: number },
): Promise<GroupPairRow[]> {
  if (o.tenantIds.length === 0) return [];
  return run(
    tx,
    sql`select tenant_id, g_id, g_key, g_name, f_id, f_key, f_name, total from (
      select fg.tenant_id, g.id as g_id, g.key as g_key, g.name as g_name, f.id as f_id, f.key as f_key,
        f.name as f_name,
        row_number() over (partition by fg.tenant_id order by g.key, f.key) as rn,
        count(*) over (partition by fg.tenant_id)::int as total
      from admin.feature_grants fg
      join admin.groups g on g.id = fg.group_id
      join admin.features f on f.id = fg.feature_id and f.status in ('on', 'beta')
      join admin.feature_commands fc on fc.feature_id = f.id and fc.command_id = ${commandId}
      where fg.tenant_id = any(${pgArray(o.tenantIds, "uuid")})
        and exists (select 1 from admin.feature_entitlements e where e.feature_id = f.id
          and e.tenant_id = fg.tenant_id and e.revoked_at is null)) x
    where rn <= ${o.max} order by tenant_id, rn`,
  );
}

/**
 * Lối tắt hiệu năng của `visibleUserCounts` (đo 50 tenant × 20 user: 38 ms → vài ms): command bật, workflow bật và
 * thuộc `core` đang `on` → mọi user active, không khoá của tenant active đều thấy (core không cần entitlement/grant,
 * BR-10/M3-R11) nên đếm thẳng — cùng kết quả với SQL tham chiếu đầy đủ.
 */
async function viaActiveCore(tx: Tx, commandId: string): Promise<boolean> {
  const rows = await run(
    tx,
    sql`select 1 from admin.commands c
    join admin.workflows w on w.id = c.workflow_id and w.enabled
    join admin.feature_commands fc on fc.command_id = c.id
    join admin.features f on f.id = fc.feature_id and f.key = ${CORE_FEATURE_KEY} and f.status = 'on'
    where c.id = ${commandId} and c.enabled`,
  );
  return rows.length > 0;
}

async function activeUserCounts(
  tx: Tx,
  tenantIds: readonly string[],
): Promise<Map<string, number>> {
  const rows = await run<{ tenant_id: string; n: number }>(
    tx,
    sql`
    select u.tenant_id, count(*)::int as n from admin.users u join admin.tenants t on t.id = u.tenant_id and t.active
    where u.tenant_id = any(${pgArray(tenantIds, "uuid")}) and u.active and not u.locked_by_tenant
    group by u.tenant_id`,
  );
  return new Map(rows.map((r) => [r.tenant_id, r.n]));
}
