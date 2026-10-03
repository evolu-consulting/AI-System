// ADM-FR-42 · M4-R03 · dòng tenant của báo cáo platform (không chọn tenant): usage trong khoảng + `quota_pct`/`level`
// theo tháng VN hiện tại (pct lớn nhất trong các dòng quota của tenant, như `evaluateQuota`). Ba câu cho ≤ 200 tenant.
import type { Tx } from "@ai/db";
import {
  evaluateQuota,
  type Level,
  monthRange,
  type QuotaRow,
  quotaLevel,
  type UsageN,
  ZERO_USAGE,
} from "../quotas/quotas.rules";
import * as repo from "./usage.repo";

type TenantOut = {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
  runs: number;
  tokens: number;
  billable_usd: string;
  cost_usd: string;
  quota_pct: number | null;
  level: Level;
};

type Month = { total: UsageN; byFeature: Map<string, UsageN> };

function monthByTenant(rows: readonly repo.MonthUsageRow[]): Map<string, Month> {
  const out = new Map<string, Month>();
  for (const x of rows) {
    const m = out.get(x.tenant_id) ?? { total: ZERO_USAGE, byFeature: new Map() };
    const u: UsageN = {
      runs: x.runs,
      tokens: Number(x.tokens),
      billableUsd: x.usd,
      unpricedRows: x.un,
    };
    if (x.is_all) m.total = u;
    else if (x.f !== null) m.byFeature.set(x.f, u);
    out.set(x.tenant_id, m);
  }
  return out;
}

function quotasByTenant(rows: readonly repo.QuotaLimitRow[]): Map<string, QuotaRow[]> {
  const out = new Map<string, QuotaRow[]>();
  for (const r of rows) {
    const list = out.get(r.tenant_id) ?? [];
    list.push({
      featureId: r.feature_id,
      maxRuns: r.max_runs,
      maxTokens: r.max_tokens === null ? null : Number(r.max_tokens),
      maxUsd: r.max_usd,
    });
    out.set(r.tenant_id, list);
  }
  return out;
}

/** pct lớn nhất (null nếu không dòng nào có giới hạn) và level tương ứng. */
function worst(
  quotas: readonly QuotaRow[],
  m: Month | undefined,
): { pct: number | null; level: Level } {
  if (quotas.length === 0) return { pct: null, level: "none" };
  const evals = evaluateQuota({
    quotas,
    total: m?.total ?? ZERO_USAGE,
    byFeature: m?.byFeature ?? new Map(),
  });
  let pct: number | null = null;
  for (const e of evals) if (e.pct !== null && (pct === null || e.pct > pct)) pct = e.pct;
  return { pct, level: quotaLevel(pct) };
}

export async function tenantQuotaLevels(
  tx: Tx,
  f: repo.UsageFilter,
  now: Date,
  limit: number,
): Promise<TenantOut[]> {
  const rows = await repo.tenantRows(tx, f, limit);
  const ids = rows.map((r) => r.tenant_id);
  const month = monthByTenant(await repo.monthUsageMany(tx, ids, monthRange(now)));
  const quotas = quotasByTenant(await repo.quotasMany(tx, ids));
  return rows.map((r) => {
    const w = worst(quotas.get(r.tenant_id) ?? [], month.get(r.tenant_id));
    return { ...r, tokens: Number(r.tokens), quota_pct: w.pct, level: w.level };
  });
}
