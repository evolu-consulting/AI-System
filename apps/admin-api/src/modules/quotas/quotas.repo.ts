// ADM-FR-40 · M4-R02, R03 · truy vấn tenant_quotas + mức dùng tháng (luôn trong withScope/configWrite → RLS, và lọc
// `tenant_id` tường minh; `hub.usage_logs` không RLS). Thứ tự khoá PUT (plan M4 §6): tenant NKU (1) → features SHARE id
// tăng (8) → delete + insert tenant_quotas (11a) → UPDATE tenants (1, đã giữ) → config_meta (14) → audit (15).
import type { LocalizedText, QuotaItemInput } from "@ai/contracts";
import { type Tx, tenantQuotas } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";
import type { UsageN } from "./quotas.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type QuotaTenant = {
  id: string;
  key: string;
  name: string;
  version: number;
  updated_at: string;
};
export type QuotaDbRow = QuotaItemInput & {
  feature_key: string | null;
  feature_name: LocalizedText | null;
};

/** Tenant thấy qua RLS; `lock` → FOR NO KEY UPDATE (hạng 1). */
export async function findTenant(tx: Tx, id: string, lock: boolean): Promise<QuotaTenant | null> {
  const rows = await run<QuotaTenant>(
    tx,
    sql`select id, key, name, version,
      to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
    from admin.tenants where id = ${id} ${lock ? sql`for no key update` : sql``}`,
  );
  return rows[0] ?? null;
}

/** Feature id của các dòng quota hiện có (không khoá; khoá ở `shareFeatures`). */
export async function quotaFeatureIds(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await run<{ f: string }>(
    tx,
    sql`select feature_id as f from admin.tenant_quotas
    where tenant_id = ${tenantId} and feature_id is not null`,
  );
  return rows.map((r) => r.f);
}

/** Feature `FOR SHARE`, id tăng (hạng 8): chặn xoá feature (cascade quota) song song. Trả id tồn tại. */
export async function shareFeatures(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  const uniq = [...new Set(ids)].sort();
  if (uniq.length === 0) return new Set();
  const rows = await run<{ id: string }>(
    tx,
    sql`select id from admin.features where id = any(${pgArray(uniq, "uuid")}) order by id for share`,
  );
  return new Set(rows.map((r) => r.id));
}

/** Bộ quota hiện tại kèm key/name feature; null trước rồi `feature_key` tăng. */
export async function listQuotas(tx: Tx, tenantId: string): Promise<QuotaDbRow[]> {
  const rows = await run<QuotaDbRow & { max_tokens: string | number | null }>(
    tx,
    sql`select q.feature_id, f.key as feature_key, f.name as feature_name,
      q.max_runs, q.max_tokens, q.max_usd::text as max_usd
    from admin.tenant_quotas q left join admin.features f on f.id = q.feature_id
    where q.tenant_id = ${tenantId}
    order by q.feature_id is not null, f.key`,
  );
  return rows.map((r) => ({
    ...r,
    max_tokens: r.max_tokens === null ? null : Number(r.max_tokens),
  }));
}

/** Thay cả bộ (hạng 11a): xoá mọi dòng của tenant rồi chèn bộ mới (đã normalize, không trùng). */
export async function replaceQuotas(
  tx: Tx,
  tenantId: string,
  items: readonly QuotaItemInput[],
  by: string,
): Promise<void> {
  await tx.execute(sql`delete from admin.tenant_quotas where tenant_id = ${tenantId}`);
  if (items.length === 0) return;
  await tx.insert(tenantQuotas).values(
    items.map((x) => ({
      tenantId,
      featureId: x.feature_id,
      maxRuns: x.max_runs,
      maxTokens: x.max_tokens,
      maxUsd: x.max_usd,
      updatedBy: by,
    })),
  );
}

/** Quota thuộc tenant (Q9): version +1, `updated_by`, `updated_at`. */
export async function bumpTenant(tx: Tx, id: string, by: string): Promise<void> {
  await tx.execute(sql`update admin.tenants
    set version = version + 1, updated_at = now(), updated_by = ${by} where id = ${id}`);
}

type UsageDb = {
  f: string | null;
  is_all: boolean;
  runs: number;
  tokens: string;
  usd: string;
  un: number;
};

/**
 * Mức dùng tháng (M4-R03) một lượt `grouping sets` trên `usage_logs_tenant_at_idx`: run = `run_id` khác nhau (NULL
 * không tính), token = input + output, USD = tổng `billable_usd` (NULL bỏ qua, đếm `unpricedRows`).
 */
export async function monthUsage(
  tx: Tx,
  tenantId: string,
  r: { from: Date; to: Date },
): Promise<{ total: UsageN; byFeature: Map<string, UsageN> }> {
  const rows = await run<UsageDb>(
    tx,
    sql`select feature_id as f, grouping(feature_id) = 1 as is_all,
      count(distinct run_id)::int as runs,
      coalesce(sum(input_tokens::bigint + output_tokens), 0)::text as tokens,
      coalesce(sum(billable_usd), 0)::text as usd,
      (count(*) filter (where billable_usd is null))::int as un
    from hub.usage_logs
    where tenant_id = ${tenantId} and at >= ${r.from.toISOString()} and at < ${r.to.toISOString()}
    group by grouping sets ((feature_id), ())`,
  );
  const toN = (x: UsageDb): UsageN => ({
    runs: x.runs,
    tokens: Number(x.tokens),
    billableUsd: x.usd,
    unpricedRows: x.un,
  });
  let total: UsageN = { runs: 0, tokens: 0, billableUsd: "0", unpricedRows: 0 };
  const byFeature = new Map<string, UsageN>();
  for (const x of rows) {
    if (x.is_all) total = toN(x);
    else if (x.f !== null) byFeature.set(x.f, toN(x));
  }
  return { total, byFeature };
}

/** Hub đã ghi dữ liệu chưa (M4-R09): `usage_logs` có hàng nào không. */
export async function hasUsageData(tx: Tx): Promise<boolean> {
  const rows = await run<{ x: number }>(tx, sql`select 1 as x from hub.usage_logs limit 1`);
  return rows.length > 0;
}
