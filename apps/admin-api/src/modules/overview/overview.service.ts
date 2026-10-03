// ADM-FR-44, ADM-FR-40, ADM-FR-51 · ui 7.2 · Q5 · `GET /admin/overview` (plan-contract §2.3, plan §5.5). Không biết HTTP.
// Một withScope (repeatable read, read only). tenant_admin: mọi câu lọc `tenant_id = actor.tenantId` (usage_logs không
// RLS); platform_admin: đếm catalog/tenants/users + runs_24h + quota_tenants. Parse strict theo kind trước khi trả.
import {
  OVERVIEW_NEVER_LOGGED_MAX,
  OVERVIEW_QUOTA_TENANTS_MAX,
  OVERVIEW_RECENT_MAX,
  OVERVIEW_UNAVAILABLE,
  type OverviewResponse,
  OverviewResponseSchema,
  type QuotaStatus,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { toAuditItem } from "../audit/audit.service";
import { bannerFor, monthRange } from "../quotas/quotas.rules";
import { quotaStatuses } from "../quotas/quotas.service";
import { worstByTenant } from "../usage/usage.tenants";
import * as repo from "./overview.repo";
import { rankQuotaTenants } from "./overview.rules";

export type OverviewCtx = { db: Db; now: () => Date };
export type OverviewCall = { ctx: OverviewCtx; actor: Actor; scope: DbScope };

async function recent(tx: Tx, actor: Actor, tenantId: string | null) {
  const rows = await repo.recentAudit(tx, tenantId, OVERVIEW_RECENT_MAX);
  return rows.map((r) => toAuditItem(r, actor));
}

/** Banner từ trạng thái quota (cùng luật `bannerFor` như `/admin/quota-banner`). */
function bannerOf(items: readonly QuotaStatus[]) {
  const b = bannerFor(
    "tenant_admin",
    items.map((i) => ({
      featureId: i.feature_id,
      pct: i.pct,
      level: i.level,
      used: {
        runs: i.used.runs,
        tokens: i.used.tokens,
        billableUsd: i.used.billable_usd,
        unpricedRows: i.used.unpriced_rows,
      },
    })),
  );
  if (!b) return null;
  const key = items.find((i) => i.feature_id === b.featureId)?.feature_key ?? null;
  return { level: b.level, pct: b.pct, feature_key: key };
}

function runsOf(tx: Tx, tenantId: string, now: Date) {
  const cur = monthRange(now);
  const prev = monthRange(new Date(cur.from.getTime() - 1));
  return repo.tenantRuns(tx, tenantId, { prevFrom: prev.from, from: cur.from, to: cur.to });
}

async function tenantOverview(
  tx: Tx,
  c: OverviewCall,
  tenantId: string,
): Promise<OverviewResponse> {
  const now = c.ctx.now();
  const head = await repo.tenantHead(tx, tenantId);
  if (!head) throw appError("NOT_FOUND");
  const counts = await repo.tenantCounts(tx, tenantId);
  const has = await repo.hasUsage(tx, tenantId);
  const runs = has ? await runsOf(tx, tenantId, now) : null;
  const q = await quotaStatuses(tx, tenantId, now);
  const never = await repo.neverLoggedIn(tx, tenantId, OVERVIEW_NEVER_LOGGED_MAX);
  return {
    kind: "tenant",
    tenant: head,
    month: q.month,
    active_users: counts.active_users,
    groups: counts.groups,
    runs_month: runs?.cur ?? null,
    runs_prev_month: runs?.prev ?? null,
    has_usage_data: has,
    quotas: q.items,
    banner: bannerOf(q.items),
    never_logged_in: never.map((u) => ({ ...u, created_at: new Date(u.created_at).toISOString() })),
    never_logged_in_total: counts.never_total,
    recent_changes: await recent(tx, c.actor, tenantId),
  };
}

async function platformOverview(tx: Tx, c: OverviewCall): Promise<OverviewResponse> {
  const now = c.ctx.now();
  const counts = await repo.platformCounts(tx);
  const has = await repo.hasUsage(tx, null);
  const heads = await repo.quotaTenants(tx);
  const worst = await worstByTenant(
    tx,
    heads.map((h) => h.id),
    now,
  );
  const ranked = rankQuotaTenants(
    heads.map((h) => ({
      tenant_id: h.id,
      tenant_key: h.key,
      tenant_name: h.name,
      ...(worst.get(h.id) ?? { pct: null, level: "none" as const }),
    })),
    OVERVIEW_QUOTA_TENANTS_MAX,
  );
  return {
    kind: "platform",
    ...counts,
    runs_24h: has ? await repo.runs24h(tx, now) : null,
    has_usage_data: has,
    quota_tenants: ranked,
    recent_changes: await recent(tx, c.actor, null),
    unavailable: [...OVERVIEW_UNAVAILABLE],
  };
}

export async function getOverview(c: OverviewCall): Promise<OverviewResponse> {
  const out = await withScope(
    c.ctx.db,
    c.scope,
    (tx) =>
      c.actor.role === "platform_admin"
        ? platformOverview(tx, c)
        : tenantOverview(tx, c, c.actor.tenantId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return OverviewResponseSchema.parse(out);
}
