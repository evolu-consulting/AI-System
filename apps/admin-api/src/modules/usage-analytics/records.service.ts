// ADM-FR-42 · usage-analytics · bản ghi usage thô: trang keyset, CSV (≤ 50.000 dòng, cột theo role), drill-down một run.
// Tenant theo actor (`resolveFilter`) + JOIN `admin.tenants` RLS; tenant_admin không thấy `cost_usd`.
import {
  USAGE_RECORDS_CSV_MAX,
  type UsageRecord,
  type UsageRecords,
  type UsageRecordsQuery,
  UsageRecordsSchema,
  type UsageRun,
  UsageRunSchema,
} from "@ai/contracts";
import type { Tx } from "@ai/db";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { resolveUsageTenant, toCsv } from "../usage/usage.rules";
import { agentLabels } from "./analytics.repo";
import {
  addMeasures,
  decodeCursor,
  encodeCursor,
  type Measures,
  normMoney,
  recordColumns,
  ZERO_MEASURES,
} from "./analytics.rules";
import { type AnalyticsCall, inScope, mustSeeTenant, resolveFilter } from "./analytics.service";
import * as repo from "./records.repo";

const PAGE = 50;
const RUN_MAX = 500;

async function withAgents(tx: Tx, rows: readonly repo.RecordRow[], platform: boolean) {
  const ids = [...new Set(rows.flatMap((r) => (r.agent_id ? [r.agent_id] : [])))];
  const keys = new Map((await agentLabels(tx, ids)).map((x) => [x.id, x.label]));
  return rows.map((r): UsageRecord => {
    const { cost_usd, ...rest } = r;
    const base = { ...rest, agent_key: r.agent_id ? (keys.get(r.agent_id) ?? null) : null };
    return platform ? { ...base, cost_usd: cost_usd === null ? null : normMoney(cost_usd) } : base;
  });
}

function recordFilter(c: AnalyticsCall, q: UsageRecordsQuery): repo.RecordFilter {
  const r = resolveFilter(c, q);
  const before = q.cursor === undefined ? undefined : decodeCursor(q.cursor);
  if (before === "invalid")
    throw validationError([
      { path: ["cursor"], code: "invalid_cursor", message: "Invalid cursor" },
    ]);
  return { ...r.filter, runId: q.run_id, from: r.fromAt, to: r.toAt, before };
}

export async function getRecords(c: AnalyticsCall, q: UsageRecordsQuery): Promise<UsageRecords> {
  const f = recordFilter(c, q);
  const limit = q.limit ?? PAGE;
  const platform = c.actor.role === "platform_admin";
  const items = await inScope(c, async (tx) => {
    await mustSeeTenant(tx, f.tenantId);
    return withAgents(tx, await repo.records(tx, f, limit + 1), platform);
  });
  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  const next = items.length > limit && last ? encodeCursor(last.at, last.id) : null;
  return UsageRecordsSchema.parse({ items: page, next_cursor: next });
}

/** CSV bản ghi theo cùng bộ lọc; tên file `usage-records-{from}-{to}.csv`. */
export async function getRecordsCsv(
  c: AnalyticsCall,
  q: UsageRecordsQuery,
): Promise<{ filename: string; body: string }> {
  const r = resolveFilter(c, q);
  const f = { ...recordFilter(c, q), before: undefined };
  const platform = c.actor.role === "platform_admin";
  const items = await inScope(c, async (tx) => {
    await mustSeeTenant(tx, f.tenantId);
    return withAgents(tx, await repo.records(tx, f, USAGE_RECORDS_CSV_MAX), platform);
  });
  const rows = items.map((x) => ({ ...x, cost_usd: x.cost_usd ?? null }));
  return {
    filename: `usage-records-${r.from}-${r.to}.csv`,
    body: toCsv(recordColumns(platform), rows),
  };
}

const measureOf = (x: UsageRecord): Measures => ({
  input_tokens: x.input_tokens,
  output_tokens: x.output_tokens,
  cache_tokens: x.cache_read_tokens + x.cache_write_tokens,
  tokens: x.input_tokens + x.output_tokens,
  calls: 1,
  runs: 0,
  errors: x.outcome === "error" ? 1 : 0,
  cost_usd: x.cost_usd ?? "0",
});

/** Drill-down: mọi dòng usage của một run (≤ 500, theo thời gian) + tổng. Không thấy dòng nào ⇒ 404. */
export async function getRun(c: AnalyticsCall, runId: string): Promise<UsageRun> {
  const t = resolveUsageTenant(c.actor, undefined);
  if (t === "not_found") throw appError("NOT_FOUND");
  const platform = c.actor.role === "platform_admin";
  const items = await inScope(c, async (tx) =>
    withAgents(
      tx,
      await repo.records(tx, { tenantId: t.tenantId, runId }, RUN_MAX, "asc"),
      platform,
    ),
  );
  if (items.length === 0) throw appError("NOT_FOUND");
  const sum = items.reduce((a, x) => addMeasures(a, measureOf(x)), ZERO_MEASURES);
  const { cost_usd, ...noCost } = sum;
  const total = platform ? { ...noCost, cost_usd, runs: 1 } : { ...noCost, runs: 1 };
  return UsageRunSchema.parse({ run_id: runId, items, total });
}
