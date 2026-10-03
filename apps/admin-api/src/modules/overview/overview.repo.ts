// ADM-FR-44 · ui 7.2 · truy vấn đếm cho Tổng quan (plan §5.5). Bảng admin.* qua RLS + lọc `tenant_id` tường minh;
// `hub.usage_logs` KHÔNG RLS → câu tenant luôn `tenant_id = $t` (dùng `usage.repo`), câu platform chỉ chạy cho
// platform_admin. Index: `users_tenant_role_active_idx` (≤ 5.000 hàng/tenant), `usage_logs (at)` cho runs_24h.
import type { AuditAction, AuditEntity } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
const one = async (tx: Tx, q: SQL): Promise<number> => (await run<{ n: number }>(tx, q))[0]?.n ?? 0;

/** Khoá tenant nội bộ của nền tảng — không tính là tenant khách (spec-decisions T6). */
export const PLATFORM_TENANT_KEY = "platform";

export type TenantHead = { id: string; key: string; name: string };

export async function tenantHead(tx: Tx, id: string): Promise<TenantHead | null> {
  const rows = await run<TenantHead>(
    tx,
    sql`select id, key, name from admin.tenants where id = ${id}`,
  );
  return rows[0] ?? null;
}

export type TenantCounts = { active_users: number; groups: number; never_total: number };

export async function tenantCounts(tx: Tx, id: string): Promise<TenantCounts> {
  const rows = await run<TenantCounts>(
    tx,
    sql`select
      (select count(*)::int from admin.users where tenant_id = ${id} and active) as active_users,
      (select count(*)::int from admin.groups where tenant_id = ${id}) as groups,
      (select count(*)::int from admin.users
        where tenant_id = ${id} and active and last_login_at is null) as never_total`,
  );
  return rows[0] ?? { active_users: 0, groups: 0, never_total: 0 };
}

export type NeverRow = { id: string; username: string; display_name: string; created_at: Date };

export async function neverLoggedIn(tx: Tx, id: string, limit: number): Promise<NeverRow[]> {
  return run<NeverRow>(
    tx,
    sql`select id, username, display_name, created_at from admin.users
    where tenant_id = ${id} and active and last_login_at is null
    order by created_at desc, id limit ${limit}`,
  );
}

export type PlatformCounts = {
  tenants_active: number;
  commands_enabled: number;
  workflows_total: number;
  workflows_unattached: number;
  users_active: number;
};

export async function platformCounts(tx: Tx): Promise<PlatformCounts> {
  const rows = await run<PlatformCounts>(
    tx,
    sql`select
      (select count(*)::int from admin.tenants
        where active and key <> ${PLATFORM_TENANT_KEY}) as tenants_active,
      (select count(*)::int from admin.commands where enabled) as commands_enabled,
      (select count(*)::int from admin.workflows) as workflows_total,
      (select count(*)::int from admin.workflows w
        where not exists (select 1 from admin.commands c where c.workflow_id = w.id)) as workflows_unattached,
      (select count(*)::int from admin.users u join admin.tenants t on t.id = u.tenant_id
        where u.active and t.key <> ${PLATFORM_TENANT_KEY}) as users_active`,
  );
  return rows[0] as PlatformCounts;
}

/** Run khác nhau trong 24 giờ trước `now` (mọi tenant — chỉ gọi cho platform_admin). */
export async function runs24h(tx: Tx, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  return one(
    tx,
    sql`select count(distinct run_id)::int as n from hub.usage_logs
    where at >= ${since}`,
  );
}

/** Tenant (thấy qua RLS) có ít nhất một dòng quota. */
export async function quotaTenants(tx: Tx): Promise<TenantHead[]> {
  return run<TenantHead>(
    tx,
    sql`select t.id, t.key, t.name from admin.tenants t
    where exists (select 1 from admin.tenant_quotas q where q.tenant_id = t.id)`,
  );
}

/** M4-R09: `usage_logs` có hàng (tenant cụ thể → luôn `tenant_id = $t`; null = toàn bảng, chỉ platform). */
export async function hasUsage(tx: Tx, tenantId: string | null): Promise<boolean> {
  const where = tenantId === null ? sql`true` : sql`tenant_id = ${tenantId}`;
  const rows = await run<{ x: number }>(
    tx,
    sql`select 1 as x from hub.usage_logs where ${where} limit 1`,
  );
  return rows.length > 0;
}

/** Run khác nhau của tenant trong [prevFrom, from) và [from, to) — index `usage_logs_tenant_at_idx`. */
export async function tenantRuns(
  tx: Tx,
  tenantId: string,
  r: { prevFrom: Date; from: Date; to: Date },
): Promise<{ cur: number; prev: number }> {
  const rows = await run<{ cur: number; prev: number }>(
    tx,
    sql`select
      (count(distinct run_id) filter (where at >= ${r.from.toISOString()}))::int as cur,
      (count(distinct run_id) filter (where at < ${r.from.toISOString()}))::int as prev
    from hub.usage_logs
    where tenant_id = ${tenantId} and at >= ${r.prevFrom.toISOString()} and at < ${r.to.toISOString()}`,
  );
  return rows[0] ?? { cur: 0, prev: 0 };
}

/** Hình hàng cho `toAuditItem` của module audit (cùng cột với `audit.repo`). */
export type RecentAuditRow = {
  id: string;
  seq: string;
  at: Date;
  tenantId: string | null;
  tenantKey: string | null;
  actorId: string | null;
  actorUsername: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string | null;
  entityName: string;
  configVersion: number | null;
  entityVersion: number | null;
  summary: Record<string, unknown>;
  snapshot: boolean;
  /** Không có dòng mới hơn cùng `(entity, entity_id)` (luật khôi phục dòng delete — `audit.rules.canRestore`). */
  latest: boolean;
};

/** `limit` hàng audit mới nhất (`seq desc`); tenantId null = mọi hàng thấy qua RLS (platform). Index
 * `audit_log_tenant_seq_idx` / `audit_log_seq_uq`. */
export async function recentAudit(
  tx: Tx,
  tenantId: string | null,
  limit: number,
): Promise<RecentAuditRow[]> {
  const where = tenantId === null ? sql`true` : sql`a.tenant_id = ${tenantId}`;
  const rows = await run<RecentAuditRow & { at: Date | string }>(
    tx,
    sql`select a.id, a.seq::text as seq, a.at, a.tenant_id as "tenantId",
      (select t.key from admin.tenants t where t.id = a.tenant_id) as "tenantKey",
      a.actor_id as "actorId", a.actor_username as "actorUsername", a.action, a.entity,
      a.entity_id as "entityId", a.entity_name as "entityName", a.config_version as "configVersion",
      a.entity_version as "entityVersion", a.summary, a.snapshot,
      not exists (select 1 from admin.audit_log n where n.entity = a.entity
        and n.entity_id = a.entity_id and n.seq > a.seq) as latest
    from admin.audit_log a where ${where}
    order by a.seq desc limit ${limit}`,
  );
  return rows.map((r) => ({ ...r, at: new Date(r.at) }));
}
