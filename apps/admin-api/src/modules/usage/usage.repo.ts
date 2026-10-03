// ADM-FR-42 · M4-R01, R03, R07 · truy vấn `hub.usage_logs` cho báo cáo (plan §5.4). Bảng Hub KHÔNG có RLS → khi có
// tenant, mọi câu luôn có `tenant_id = $t` tường minh (service bảo đảm tenant_admin luôn có tenant). Index:
// `usage_logs_tenant_at_idx` (tenant, at) / `usage_logs_tenant_feature_at_idx` khi lọc feature / `usage_logs (at)` khi
// platform không chọn tenant. Run = `run_id` khác nhau (NULL không tính); token = input + output; USD theo billable.
import type { LocalizedText } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";
import { QUOTA_TZ_OFFSET_MIN } from "../quotas/quotas.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type UsageFilter = {
  tenantId: string | null;
  featureId: string | null;
  from: Date;
  to: Date;
};

/** Ngày VN của `at` (`YYYY-MM-DD`), offset cố định (M4-R01, không DST). */
const VN_DAY = sql.raw(
  `to_char((at at time zone 'UTC') + interval '${QUOTA_TZ_OFFSET_MIN} minutes', 'YYYY-MM-DD')`,
);

/** Điều kiện tenant/feature (không gồm thời gian). */
function scopeWhere(f: Pick<UsageFilter, "tenantId" | "featureId">): SQL {
  const t = f.tenantId === null ? sql`true` : sql`tenant_id = ${f.tenantId}`;
  if (f.featureId === null) return t;
  if (f.featureId === "none") return sql`${t} and feature_id is null`;
  return sql`${t} and feature_id = ${f.featureId}`;
}

const inRange = (from: Date, to: Date) =>
  sql`at >= ${from.toISOString()} and at < ${to.toISOString()}`;

const AGG = sql`count(distinct run_id)::int as runs,
  coalesce(sum(input_tokens::bigint + output_tokens), 0)::text as tokens,
  coalesce(sum(billable_usd), 0)::text as billable_usd,
  coalesce(sum(cost_usd), 0)::text as cost_usd,
  (count(*) filter (where billable_usd is null))::int as unpriced_rows`;

export type KpiRow = {
  cur: boolean;
  runs: number;
  tokens: string;
  input_tokens: string;
  output_tokens: string;
  billable_usd: string;
  cost_usd: string;
  margin_usd: string;
  unpriced_rows: number;
  overage_runs: number;
};

/** KPI khoảng hiện tại (`cur`) và khoảng liền trước trong một lượt quét [prevFrom, to). */
export async function kpis(tx: Tx, f: UsageFilter, prevFrom: Date): Promise<KpiRow[]> {
  return run<KpiRow>(
    tx,
    sql`select at >= ${f.from.toISOString()} as cur, ${AGG},
      coalesce(sum(input_tokens::bigint), 0)::text as input_tokens,
      coalesce(sum(output_tokens::bigint), 0)::text as output_tokens,
      (coalesce(sum(billable_usd), 0) - coalesce(sum(cost_usd), 0))::text as margin_usd,
      (count(*) filter (where billable_usd is null))::int as unpriced_rows,
      (count(distinct run_id) filter (where overage))::int as overage_runs
    from hub.usage_logs where ${scopeWhere(f)} and ${inRange(prevFrom, f.to)}
    group by 1`,
  );
}

export type DayRow = {
  date: string;
  runs: number;
  tokens: string;
  billable_usd: string;
  cost_usd: string;
  overage_billable_usd: string;
};

export async function daily(tx: Tx, f: UsageFilter): Promise<DayRow[]> {
  return run<DayRow>(
    tx,
    sql`select ${VN_DAY} as date, ${AGG},
      coalesce(sum(billable_usd) filter (where overage), 0)::text as overage_billable_usd
    from hub.usage_logs where ${scopeWhere(f)} and ${inRange(f.from, f.to)}
    group by 1 order by 1`,
  );
}

export type TopFeatureRow = {
  feature_id: string | null;
  feature_key: string | null;
  feature_name: LocalizedText | null;
  runs: number;
  tokens: string;
  billable_usd: string;
  cost_usd: string;
  unpriced_rows: number;
  overage: boolean;
};

/** ≤ `limit` feature theo billable giảm (NULL = "Không theo feature"); join `features` sau khi cắt. */
export async function topFeatures(tx: Tx, f: UsageFilter, limit: number): Promise<TopFeatureRow[]> {
  return run<TopFeatureRow>(
    tx,
    sql`select g.*, fe.key as feature_key, fe.name as feature_name from (
      select feature_id, ${AGG}, bool_or(overage) as overage
      from hub.usage_logs where ${scopeWhere(f)} and ${inRange(f.from, f.to)}
      group by feature_id
      order by sum(billable_usd) desc nulls last, count(distinct run_id) desc, feature_id nulls last
      limit ${limit}) g
    left join admin.features fe on fe.id = g.feature_id
    order by g.billable_usd::numeric desc, g.runs desc, g.feature_id nulls last`,
  );
}

export type TopUserRow = {
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  runs: number;
  tokens: string;
  billable_usd: string;
  cost_usd: string;
  unpriced_rows: number;
};

/** ≤ `limit` user; `users` tra theo PK sau khi cắt (join RLS sớm → plan xấu, xem `lib/sql` usernameOf). */
export async function topUsers(tx: Tx, f: UsageFilter, limit: number): Promise<TopUserRow[]> {
  return run<TopUserRow>(
    tx,
    sql`select g.*, u.username, u.display_name from (
      select user_id, ${AGG}
      from hub.usage_logs where ${scopeWhere(f)} and ${inRange(f.from, f.to)}
      group by user_id
      order by sum(billable_usd) desc nulls last, count(distinct run_id) desc, user_id nulls last
      limit ${limit}) g
    left join admin.users u on u.id = g.user_id
    order by g.billable_usd::numeric desc, g.runs desc, g.user_id nulls last`,
  );
}

export type TenantRow = {
  tenant_id: string;
  tenant_key: string;
  tenant_name: string;
  runs: number;
  tokens: string;
  billable_usd: string;
  cost_usd: string;
};

/** Mọi tenant thấy qua RLS (platform) kèm usage trong khoảng; billable giảm rồi key. */
export async function tenantRows(tx: Tx, f: UsageFilter, limit: number): Promise<TenantRow[]> {
  return run<TenantRow>(
    tx,
    sql`select t.id as tenant_id, t.key as tenant_key, t.name as tenant_name,
      coalesce(g.runs, 0)::int as runs, coalesce(g.tokens, '0') as tokens,
      coalesce(g.billable_usd, '0') as billable_usd, coalesce(g.cost_usd, '0') as cost_usd
    from admin.tenants t left join (
      select tenant_id, ${AGG}
      from hub.usage_logs where ${scopeWhere(f)} and ${inRange(f.from, f.to)}
      group by tenant_id) g on g.tenant_id = t.id
    order by coalesce(g.billable_usd::numeric, 0) desc, t.key
    limit ${limit}`,
  );
}

export type MonthUsageRow = {
  tenant_id: string;
  f: string | null;
  is_all: boolean;
  runs: number;
  tokens: string;
  usd: string;
  un: number;
};

/** Mức dùng tháng của nhiều tenant (grouping sets như `quotas.repo.monthUsage`). */
export async function monthUsageMany(
  tx: Tx,
  ids: readonly string[],
  r: { from: Date; to: Date },
): Promise<MonthUsageRow[]> {
  if (ids.length === 0) return [];
  return run<MonthUsageRow>(
    tx,
    sql`select tenant_id, feature_id as f, grouping(feature_id) = 1 as is_all,
      count(distinct run_id)::int as runs,
      coalesce(sum(input_tokens::bigint + output_tokens), 0)::text as tokens,
      coalesce(sum(billable_usd), 0)::text as usd,
      (count(*) filter (where billable_usd is null))::int as un
    from hub.usage_logs
    where tenant_id = any(${pgArray(ids, "uuid")}) and ${inRange(r.from, r.to)}
    group by grouping sets ((tenant_id, feature_id), (tenant_id))`,
  );
}

export type QuotaLimitRow = {
  tenant_id: string;
  feature_id: string | null;
  max_runs: number | null;
  max_tokens: string | number | null;
  max_usd: string | null;
};

export async function quotasMany(tx: Tx, ids: readonly string[]): Promise<QuotaLimitRow[]> {
  if (ids.length === 0) return [];
  return run<QuotaLimitRow>(
    tx,
    sql`select tenant_id, feature_id, max_runs, max_tokens, max_usd::text as max_usd
    from admin.tenant_quotas where tenant_id = any(${pgArray(ids, "uuid")})`,
  );
}

/** M4-R09: có ≥ 1 hàng usage bất kỳ thời điểm trong phạm vi tenant (null = mọi tenant). */
export async function hasData(tx: Tx, tenantId: string | null): Promise<boolean> {
  const where = tenantId === null ? sql`true` : sql`tenant_id = ${tenantId}`;
  const rows = await run<{ x: number }>(
    tx,
    sql`select 1 as x from hub.usage_logs where ${where} limit 1`,
  );
  return rows.length > 0;
}

/** Tenant tồn tại trong scope (RLS `tenants`). */
export async function tenantKey(tx: Tx, id: string): Promise<string | null> {
  const rows = await run<{ key: string }>(tx, sql`select key from admin.tenants where id = ${id}`);
  return rows[0]?.key ?? null;
}

export type CsvRow = {
  date: string;
  tenant_key: string | null;
  feature_key: string | null;
  runs: number;
  input_tokens: string;
  output_tokens: string;
  billable_usd: string | null;
  cost_usd: string | null;
  overage_runs: number;
};

/** Một dòng / (ngày VN × tenant × feature); USD NULL khi mọi hàng nhóm chưa định giá. */
export async function csvRows(tx: Tx, f: UsageFilter, limit: number): Promise<CsvRow[]> {
  return run<CsvRow>(
    tx,
    sql`select g.date, t.key as tenant_key, fe.key as feature_key, g.runs, g.input_tokens, g.output_tokens,
      g.billable_usd, g.cost_usd, g.overage_runs
    from (
      select ${VN_DAY} as date, tenant_id, feature_id,
        count(distinct run_id)::int as runs,
        coalesce(sum(input_tokens::bigint), 0)::text as input_tokens,
        coalesce(sum(output_tokens::bigint), 0)::text as output_tokens,
        sum(billable_usd)::text as billable_usd, sum(cost_usd)::text as cost_usd,
        (count(distinct run_id) filter (where overage))::int as overage_runs
      from hub.usage_logs where ${scopeWhere(f)} and ${inRange(f.from, f.to)}
      group by 1, 2, 3) g
    left join admin.tenants t on t.id = g.tenant_id
    left join admin.features fe on fe.id = g.feature_id
    order by g.date, t.key nulls last, fe.key nulls first
    limit ${limit}`,
  );
}
