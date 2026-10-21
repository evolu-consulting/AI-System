// ADM-FR-42 · usage-analytics · bản ghi thô `hub.usage_logs` (bảng không RLS): service LUÔN đặt tenant của tenant_admin
// vào bộ lọc, và câu JOIN `admin.tenants` (RLS theo scope) ⇒ dòng tenant khác không bao giờ ra. Phân trang keyset
// (at, id) giảm dần qua index (tenant_id, at) / (at); cắt trước rồi mới tra nhãn (user, tenant) theo PK.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { dimWhere, type Filter } from "./analytics.repo";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type RecordFilter = Filter & {
  runId?: string;
  /** Vắng ⇒ không lọc thời gian (drill-down một run). */
  from?: Date;
  to?: Date;
  before?: { at: string; id: string };
};

export type RecordRow = {
  id: string;
  at: string;
  tenant_id: string;
  tenant_key: string;
  user_id: string | null;
  username: string | null;
  app: string;
  feature: string | null;
  agent_id: string | null;
  run_id: string | null;
  provider_key: string | null;
  model: string | null;
  billing: string;
  outcome: "ok" | "error" | "cancelled" | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number | null;
  cost_usd: string | null;
};

const APP = sql`hub.usage_app(l.app, l.feature, l.billing)`;

function where(f: RecordFilter): SQL {
  const parts: SQL[] = [dimWhere(f, APP, "l")];
  if (f.runId) parts.push(sql`l.run_id = ${f.runId}::uuid`);
  if (f.from) parts.push(sql`l.at >= ${f.from.toISOString()}::timestamptz`);
  if (f.to) parts.push(sql`l.at < ${f.to.toISOString()}::timestamptz`);
  if (f.before) parts.push(sql`(l.at, l.id) < (${f.before.at}::timestamptz, ${f.before.id}::uuid)`);
  return sql.join(parts, sql` and `);
}

/** ≤ `limit` dòng mới nhất trước (`asc` cho drill-down run: theo thời gian tăng). */
export function records(
  tx: Tx,
  f: RecordFilter,
  limit: number,
  order: "desc" | "asc" = "desc",
): Promise<RecordRow[]> {
  const dir = sql.raw(order);
  return run<RecordRow>(
    tx,
    sql`select g.id, to_char(g.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at, g.tenant_id,
      t.key as tenant_key, g.user_id, u.username, g.app, g.feature, g.agent_id, g.run_id, g.provider_key, g.model,
      g.billing, g.outcome, g.input_tokens, g.output_tokens, g.cache_read_tokens, g.cache_write_tokens, g.latency_ms,
      g.cost_usd
    from (
      select l.id::text as id, l.at, l.tenant_id::text as tenant_id, l.user_id::text as user_id, ${APP} as app,
        l.feature, l.agent_id::text as agent_id, l.run_id::text as run_id, l.provider_key, l.model, l.billing,
        l.outcome, l.input_tokens, l.output_tokens, coalesce(l.cache_read_tokens, 0) as cache_read_tokens,
        coalesce(l.cache_write_tokens, 0) as cache_write_tokens, l.latency_ms, l.cost_usd::text as cost_usd
      from hub.usage_logs l where ${where(f)}
      order by l.at ${dir}, l.id ${dir} limit ${limit}) g
    join admin.tenants t on t.id = g.tenant_id::uuid
    left join admin.users u on u.id = g.user_id::uuid
    order by g.at ${dir}, g.id ${dir}`,
  );
}
