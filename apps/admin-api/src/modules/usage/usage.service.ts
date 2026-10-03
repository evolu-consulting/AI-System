// ADM-FR-42, ADM-BR-09 · M4-R03, R07–R09 · báo cáo chi phí & usage (plan-contract §2.2, plan §5.4). Không biết HTTP.
// Một withScope (repeatable read, read only). Dựng bản Platform rồi `stripCost` cho tenant_admin và parse đúng schema
// role (strict) trước khi trả → tenant_admin không bao giờ thấy cost_usd/margin_usd/tenants (M4-AC03).
import {
  type Role,
  USAGE_TENANTS_MAX,
  USAGE_TOP_MAX,
  type UsageKpi,
  type UsageQuery,
  type UsageReportPlatform,
  UsageReportPlatformSchema,
  type UsageReportTenant,
  UsageReportTenantSchema,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { quotaStatuses } from "../quotas/quotas.service";
import * as repo from "./usage.repo";
import { csvColumns, resolveUsageTenant, stripCost, toCsv, usageRange } from "./usage.rules";
import { tenantQuotaLevels } from "./usage.tenants";

export type UsageCtx = { db: Db; now: () => Date };
export type UsageCall = { ctx: UsageCtx; actor: Actor; scope: DbScope };

/** Số dòng CSV tối đa (≈ 366 ngày × 136 tenant×feature); vượt thì cắt (spec-decisions T5). */
export const CSV_MAX_ROWS = 50_000;

type Resolved = {
  filter: repo.UsageFilter;
  prevFrom: Date;
  days: string[];
  from: string;
  to: string;
};

/** Khoảng + tenant (role) → bộ lọc; sai khoảng → 400; tenant khác (tenant_admin) → 404. */
function resolve(c: UsageCall, q: UsageQuery): Resolved {
  const r = usageRange(q, c.ctx.now());
  if (r === "invalid")
    throw validationError([{ path: ["from"], code: "invalid_range", message: "Invalid range" }]);
  const t = resolveUsageTenant(c.actor, q.tenant_id);
  if (t === "not_found") throw appError("NOT_FOUND");
  // Bảng Hub không RLS: tenant_admin bắt buộc có tenant cụ thể (resolveUsageTenant bảo đảm).
  if (c.actor.role !== "platform_admin" && t.tenantId !== c.actor.tenantId)
    throw appError("NOT_FOUND");
  return {
    filter: { tenantId: t.tenantId, featureId: q.feature_id ?? null, from: r.from, to: r.to },
    prevFrom: r.prevFrom,
    days: r.days,
    from: r.days[0] as string,
    to: r.days[r.days.length - 1] as string,
  };
}

function inScope<T>(c: UsageCall, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withScope(c.ctx.db, c.scope, fn, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/** Tenant chọn phải thấy được qua RLS; trả key (cho tên file CSV). */
async function mustTenantKey(tx: Tx, id: string | null): Promise<string | null> {
  if (id === null) return null;
  const key = await repo.tenantKey(tx, id);
  if (key === null) throw appError("NOT_FOUND");
  return key;
}

const ZERO_KPI: repo.KpiRow = {
  cur: true,
  runs: 0,
  tokens: "0",
  input_tokens: "0",
  output_tokens: "0",
  billable_usd: "0",
  cost_usd: "0",
  margin_usd: "0",
  unpriced_rows: 0,
  overage_runs: 0,
};

function toKpi(rows: readonly repo.KpiRow[], cur: boolean): UsageKpi {
  const k = rows.find((r) => r.cur === cur) ?? ZERO_KPI;
  return {
    runs: k.runs,
    tokens: Number(k.tokens),
    input_tokens: Number(k.input_tokens),
    output_tokens: Number(k.output_tokens),
    billable_usd: k.billable_usd,
    unpriced_rows: k.unpriced_rows,
    overage_runs: k.overage_runs,
    cost_usd: k.cost_usd,
    margin_usd: k.margin_usd,
  };
}

/** Đủ mọi ngày trong khoảng; ngày không có hàng = 0. */
function fillDays(days: readonly string[], rows: readonly repo.DayRow[]) {
  const by = new Map(rows.map((r) => [r.date, r]));
  return days.map((date) => {
    const r = by.get(date);
    return {
      date,
      runs: r?.runs ?? 0,
      tokens: Number(r?.tokens ?? 0),
      billable_usd: r?.billable_usd ?? "0",
      overage_billable_usd: r?.overage_billable_usd ?? "0",
      cost_usd: r?.cost_usd ?? "0",
    };
  });
}

async function buildReport(tx: Tx, c: UsageCall, r: Resolved): Promise<UsageReportPlatform> {
  const f = r.filter;
  await mustTenantKey(tx, f.tenantId);
  const k = await repo.kpis(tx, f, r.prevFrom);
  const feats = await repo.topFeatures(tx, f, USAGE_TOP_MAX);
  const users = await repo.topUsers(tx, f, USAGE_TOP_MAX);
  const platformAll = c.actor.role === "platform_admin" && f.tenantId === null;
  return {
    range: { from: r.from, to: r.to },
    tenant_id: f.tenantId,
    feature_id: f.featureId,
    has_data: await repo.hasData(tx, f.tenantId),
    kpi: toKpi(k, true),
    previous: toKpi(k, false),
    daily: fillDays(r.days, await repo.daily(tx, f)),
    top_features: feats.map((x) => ({ ...x, tokens: Number(x.tokens) })),
    top_users: users.map((x) => ({ ...x, tokens: Number(x.tokens) })),
    quotas: f.tenantId === null ? [] : (await quotaStatuses(tx, f.tenantId, c.ctx.now())).items,
    tenants: platformAll ? await tenantQuotaLevels(tx, f, c.ctx.now(), USAGE_TENANTS_MAX) : [],
  };
}

export async function getUsage(
  c: UsageCall,
  q: UsageQuery,
): Promise<UsageReportPlatform | UsageReportTenant> {
  const r = resolve(c, q);
  const report = await inScope(c, (tx) => buildReport(tx, c, r));
  if (c.actor.role === "platform_admin") return UsageReportPlatformSchema.parse(report);
  return UsageReportTenantSchema.parse(stripCost(c.actor.role, report));
}

const cell = (role: Role, x: repo.CsvRow): Record<string, string | number | null> => {
  const row: Record<string, string | number | null> = {
    date: x.date,
    tenant_key: x.tenant_key,
    feature_key: x.feature_key,
    runs: x.runs,
    input_tokens: x.input_tokens,
    output_tokens: x.output_tokens,
    billable_usd: x.billable_usd,
    overage_runs: x.overage_runs,
  };
  if (role === "platform_admin") row.cost_usd = x.cost_usd;
  return row;
};

/** CSV theo cột của role (tenant_admin không có cột/giá trị cost) + tên file `usage-{key|all}-{from}-{to}.csv`. */
export async function getUsageCsv(
  c: UsageCall,
  q: UsageQuery,
): Promise<{ filename: string; body: string }> {
  const r = resolve(c, q);
  const { key, rows } = await inScope(c, async (tx) => ({
    key: await mustTenantKey(tx, r.filter.tenantId),
    rows: await repo.csvRows(tx, r.filter, CSV_MAX_ROWS),
  }));
  const role = c.actor.role;
  return {
    filename: `usage-${key ?? "all"}-${r.from}-${r.to}.csv`,
    body: toCsv(
      csvColumns(role),
      rows.map((x) => cell(role, x)),
    ),
  };
}
