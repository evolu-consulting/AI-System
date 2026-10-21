// ADM-FR-42 · usage-analytics · phân tích token theo tenant/app/agent/model/user/kết quả (không biết HTTP). Tenant lấy từ
// actor (`resolveUsageTenant`: tenant_admin luôn bị ép tenant mình, tenant khác ⇒ 404) VÀ RLS của `hub.usage_daily` /
// `admin.tenants` theo scope — tham số client một mình không bao giờ mở được dữ liệu tenant khác. tenant_admin không thấy
// `cost_usd` (`stripCost`, như M4-AC03). Một transaction repeatable read, read only; số câu SQL cố định.
import {
  USAGE_BREAKDOWN_MAX,
  type UsageAnalytics,
  type UsageAnalyticsKpi,
  type UsageAnalyticsQuery,
  UsageAnalyticsSchema,
  type UsageBreakdownRow,
  type UsageGrain,
  type UsageTreeRow,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { resolveUsageTenant, stripCost, usageRange } from "../usage/usage.rules";
import * as repo from "./analytics.repo";
import {
  bucketsOf,
  type GroupCol,
  type Measures,
  measuresOf,
  modelTier,
  previousFrom,
  setOf,
  sortTop,
  tiersOf,
  ZERO_MEASURES,
} from "./analytics.rules";

export type AnalyticsCtx = { db: Db; now: () => Date };
export type AnalyticsCall = { ctx: AnalyticsCtx; actor: Actor; scope: DbScope };

export type Resolved = {
  filter: repo.Filter;
  from: string;
  to: string;
  fromAt: Date;
  toAt: Date;
};

/** Khoảng (ngày VN) + tenant theo role; sai khoảng ⇒ 400; tenant khác (tenant_admin) ⇒ 404. */
export function resolveFilter(c: AnalyticsCall, q: Omit<UsageAnalyticsQuery, "grain">): Resolved {
  const r = usageRange(q, c.ctx.now());
  if (r === "invalid")
    throw validationError([{ path: ["from"], code: "invalid_range", message: "Invalid range" }]);
  const t = resolveUsageTenant(c.actor, q.tenant_id);
  if (t === "not_found") throw appError("NOT_FOUND");
  if (c.actor.role !== "platform_admin" && t.tenantId !== c.actor.tenantId)
    throw appError("NOT_FOUND");
  const { app, feature, model, outcome } = q;
  return {
    filter: {
      tenantId: t.tenantId,
      app,
      feature,
      model,
      outcome,
      agentId: q.agent_id,
      userId: q.user_id,
    },
    from: r.days[0] as string,
    to: r.days[r.days.length - 1] as string,
    fromAt: r.from,
    toAt: r.to,
  };
}

export function inScope<T>(c: AnalyticsCall, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withScope(c.ctx.db, c.scope, fn, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/** Tenant chọn phải thấy được qua RLS (`admin.tenants`). */
export async function mustSeeTenant(tx: Tx, id: string | null): Promise<void> {
  if (id === null) return;
  if ((await repo.tenantLabels(tx, [id])).length === 0) throw appError("NOT_FOUND");
}

function kpiOf(rows: readonly repo.KpiRow[], cur: boolean): UsageAnalyticsKpi {
  const k = rows.find((r) => r.cur === cur);
  if (!k) return { ...ZERO_MEASURES, unpriced: 0, avg_latency_ms: null };
  const n = Number(k.lat_n);
  return {
    ...measuresOf(k),
    unpriced: Number(k.unpriced),
    avg_latency_ms: n === 0 ? null : Math.round(Number(k.lat_sum) / n),
  };
}

type Split = Record<GroupCol, repo.GroupRow[]> & { tree: repo.GroupRow[] };

function split(rows: readonly repo.GroupRow[]): Split {
  const out: Split = {
    app: [],
    agent_id: [],
    model: [],
    feature: [],
    tenant_id: [],
    outcome: [],
    tree: [],
  };
  for (const r of rows) {
    const s = setOf(r.g);
    if (s) out[s].push(r);
  }
  return out;
}

const row = (key: string | null, label: string | null, m: Measures): UsageBreakdownRow => ({
  key,
  label,
  ...m,
});

/** Một chiều: top `n` theo token; nhãn = khoá (gắn nhãn thật sau bằng `labeled`). */
function dim(rows: readonly repo.GroupRow[], col: GroupCol, n: number): UsageBreakdownRow[] {
  return sortTop(
    rows.map((r) => row(r[col], r[col], measuresOf(r))),
    n,
  );
}

const keysOf = (rows: readonly { key: string | null }[]) =>
  rows.map((r) => r.key).filter((x): x is string => x !== null);

const labeled = (rows: UsageBreakdownRow[], m: Map<string, string>) =>
  rows.map((r) => (r.key === null ? r : { ...r, label: m.get(r.key) ?? r.key }));

/** Ba câu tra nhãn theo lô (chỉ cho các khoá đã cắt top). */
async function labelMaps(tx: Tx, ids: { agents: string[]; users: string[]; tenants: string[] }) {
  const toMap = (xs: repo.Label[]) => new Map(xs.map((x) => [x.id, x.label]));
  return {
    agents: toMap(await repo.agentLabels(tx, [...new Set(ids.agents)])),
    users: toMap(await repo.userLabels(tx, ids.users)),
    tenants: toMap(await repo.tenantLabels(tx, ids.tenants)),
  };
}

function tree(rows: readonly repo.GroupRow[]): UsageTreeRow[] {
  const all = rows.map((r) => ({
    key: r.agent_id,
    app: r.app ?? "other",
    agent_id: r.agent_id,
    agent_key: null as string | null,
    feature: r.feature,
    model: r.model,
    tier: modelTier(r.model),
    ...measuresOf(r),
  }));
  return sortTop(all, USAGE_BREAKDOWN_MAX * 2).map(({ key: _k, ...t }) => t);
}

function fillSeries(rows: readonly repo.SeriesRow[], from: string, to: string, g: UsageGrain) {
  const apps = [...new Set(rows.map((r) => r.app))];
  const by = new Map(rows.map((r) => [`${r.bucket}|${r.app}`, r]));
  return bucketsOf(from, to, g).flatMap((bucket) =>
    apps.map((app) => {
      const r = by.get(`${bucket}|${app}`);
      return { bucket, app, ...(r ? measuresOf(r) : ZERO_MEASURES) };
    }),
  );
}

async function build(
  tx: Tx,
  c: AnalyticsCall,
  r: Resolved,
  grain: UsageGrain,
): Promise<UsageAnalytics> {
  const f = r.filter;
  await mustSeeTenant(tx, f.tenantId);
  const k = await repo.kpis(tx, f, {
    prevFrom: previousFrom(r.from, r.to),
    from: r.from,
    to: r.to,
  });
  const ser = await repo.series(tx, f, { from: r.from, to: r.to, grain });
  const s = split(await repo.breakdown(tx, f, { from: r.from, to: r.to }));
  const N = USAGE_BREAKDOWN_MAX;
  const platformAll = c.actor.role === "platform_admin" && f.tenantId === null;
  const byAgent = dim(s.agent_id, "agent_id", N);
  const users = await repo.byUser(tx, f, { from: r.from, to: r.to }, N);
  const byUser = users.map((u) => row(u.user_id, u.user_id, measuresOf(u)));
  const byTenant = platformAll ? dim(s.tenant_id, "tenant_id", N) : [];
  const tr = tree(s.tree);
  const l = await labelMaps(tx, {
    agents: [...keysOf(byAgent), ...tr.flatMap((t) => (t.agent_id ? [t.agent_id] : []))],
    users: keysOf(byUser),
    tenants: keysOf(byTenant),
  });
  return {
    range: { from: r.from, to: r.to },
    grain,
    tenant_id: f.tenantId,
    kpi: kpiOf(k, true),
    previous: kpiOf(k, false),
    series: fillSeries(ser, r.from, r.to, grain),
    by_app: dim(s.app, "app", Infinity),
    by_agent: labeled(byAgent, l.agents),
    by_model: dim(s.model, "model", N),
    by_tier: tiersOf(dim(s.model, "model", Infinity)),
    by_feature: dim(s.feature, "feature", N),
    by_user: labeled(byUser, l.users),
    by_outcome: dim(s.outcome, "outcome", Infinity),
    by_tenant: labeled(byTenant, l.tenants),
    tree: tr.map((t) => ({
      ...t,
      agent_key: t.agent_id ? (l.agents.get(t.agent_id) ?? null) : null,
    })),
  };
}

export async function getAnalytics(
  c: AnalyticsCall,
  q: UsageAnalyticsQuery,
): Promise<UsageAnalytics> {
  const r = resolveFilter(c, q);
  const grain = q.grain ?? "day";
  const out = await inScope(c, (tx) => build(tx, c, r, grain));
  return UsageAnalyticsSchema.parse(stripCost(c.actor.role, out));
}
