// ADM-FR-42 · usage-analytics · SQL trên bảng tổng hợp ngày `hub.usage_daily` (hub 0049; RLS admin_rw: tenant chỉ thấy
// tenant mình) — không quét `hub.usage_logs` thô. Số câu cố định mỗi báo cáo: KPI (kỳ này + kỳ trước, một lượt), chuỗi thời
// gian, breakdown (MỘT câu GROUPING SETS cho mọi chiều + cây app→agent→feature→model), rồi tra nhãn theo lô (agent/user/tenant).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";
import { GROUP_COLS, type MeasureRow } from "./analytics.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type Filter = {
  tenantId: string | null;
  app?: string;
  feature?: string;
  agentId?: string;
  model?: string;
  userId?: string;
  outcome?: string;
};

/** Điều kiện chiều (không gồm thời gian) trên bảng alias `t`; `app` = cột app của rollup hoặc biểu thức của bảng thô. */
export function dimWhere(f: Filter, app: SQL, t: string): SQL {
  const c = (col: string) => sql.raw(`${t}.${col}`);
  const parts: SQL[] = [sql`true`];
  if (f.tenantId !== null) parts.push(sql`${c("tenant_id")} = ${f.tenantId}::uuid`);
  if (f.app) parts.push(sql`${app} = ${f.app}`);
  if (f.feature) parts.push(sql`${c("feature")} = ${f.feature}`);
  if (f.agentId) parts.push(sql`${c("agent_id")} = ${f.agentId}::uuid`);
  if (f.model) parts.push(sql`${c("model")} = ${f.model}`);
  if (f.userId) parts.push(sql`${c("user_id")} = ${f.userId}::uuid`);
  if (f.outcome) parts.push(sql`${c("outcome")} = ${f.outcome}`);
  return sql.join(parts, sql` and `);
}

const rollupWhere = (f: Filter, from: string, to: string) =>
  sql`${dimWhere(f, sql`d.app`, "d")} and d.day >= ${from}::date and d.day <= ${to}::date`;

const MEASURES = sql`coalesce(sum(d.input_tokens), 0)::text as input_tokens,
  coalesce(sum(d.output_tokens), 0)::text as output_tokens,
  coalesce(sum(d.cache_read_tokens + d.cache_write_tokens), 0)::text as cache_tokens,
  coalesce(sum(d.calls), 0)::text as calls, coalesce(sum(d.runs), 0)::text as runs,
  coalesce(sum(d.calls) filter (where d.outcome = 'error'), 0)::text as errors,
  coalesce(sum(d.cost_usd), 0)::text as cost_usd`;

export type KpiRow = MeasureRow & {
  cur: boolean;
  unpriced: string;
  lat_sum: string;
  lat_n: string;
};

/** KPI kỳ này (`cur`) và kỳ liền trước trong một lượt quét [prevFrom, to]. */
export function kpis(tx: Tx, f: Filter, r: { prevFrom: string; from: string; to: string }) {
  return run<KpiRow>(
    tx,
    sql`select d.day >= ${r.from}::date as cur, ${MEASURES},
      coalesce(sum(d.unpriced), 0)::text as unpriced, coalesce(sum(d.latency_ms_sum), 0)::text as lat_sum,
      coalesce(sum(d.latency_n), 0)::text as lat_n
    from hub.usage_daily d where ${rollupWhere(f, r.prevFrom, r.to)} group by 1`,
  );
}

export type SeriesRow = MeasureRow & { bucket: string; app: string };

export function series(tx: Tx, f: Filter, r: { from: string; to: string; grain: string }) {
  return run<SeriesRow>(
    tx,
    sql`select to_char(date_trunc(${r.grain}::text, d.day::timestamp), 'YYYY-MM-DD') as bucket, d.app, ${MEASURES}
    from hub.usage_daily d where ${rollupWhere(f, r.from, r.to)} group by 1, 2 order by 1, 2`,
  );
}

export type GroupRow = MeasureRow & {
  g: number;
  app: string | null;
  agent_id: string | null;
  model: string | null;
  feature: string | null;
  user_id: string | null;
  tenant_id: string | null;
  outcome: string | null;
};

const G = sql.raw(GROUP_COLS.map((c) => `d.${c}`).join(", "));

/** MỘT câu: mọi chiều đơn + cây (app, agent, feature, model). `g` = mặt nạ grouping (xem `setOf`). */
export function breakdown(tx: Tx, f: Filter, r: { from: string; to: string }) {
  return run<GroupRow>(
    tx,
    sql`select grouping(${G})::int as g, d.app, d.agent_id::text as agent_id, d.model, d.feature,
      d.user_id::text as user_id, d.tenant_id::text as tenant_id, d.outcome, ${MEASURES}
    from hub.usage_daily d where ${rollupWhere(f, r.from, r.to)}
    group by grouping sets ((d.app), (d.agent_id), (d.model), (d.feature), (d.user_id), (d.tenant_id), (d.outcome),
      (d.app, d.agent_id, d.feature, d.model))`,
  );
}

export type Label = { id: string; label: string };

/** Nhãn agent (key) qua hàm Hub (admin không đọc `hub.agents`). */
export function agentLabels(tx: Tx, ids: readonly string[]): Promise<Label[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return run<Label>(
    tx,
    sql`select id::text as id, key as label from hub.agent_labels(${pgArray(ids, "uuid")})`,
  );
}

export function userLabels(tx: Tx, ids: readonly string[]): Promise<Label[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return run<Label>(
    tx,
    sql`select id::text as id, username as label from admin.users where id = any(${pgArray(ids, "uuid")})`,
  );
}

export function tenantLabels(tx: Tx, ids: readonly string[]): Promise<Label[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return run<Label>(
    tx,
    sql`select id::text as id, key as label from admin.tenants where id = any(${pgArray(ids, "uuid")})`,
  );
}
