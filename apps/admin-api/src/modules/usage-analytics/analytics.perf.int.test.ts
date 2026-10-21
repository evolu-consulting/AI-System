// ADM-FR-42 · usage-analytics · Luật 4c: 1.000.000 dòng `hub.usage_logs` (90 ngày, 4 tenant, 200 user, 24 agent, 3 model,
// 5 app, 5% lỗi; dựng MỘT câu generate_series — trigger theo câu lệnh dựng `hub.usage_daily`) trên DB đầy đủ Admin + Hub,
// role `admin_api` + scope thật. Ngưỡng p95 ≤ 300 ms mỗi lời gọi service (20 lần sau 2 lần làm nóng): analytics platform
// 90 ngày/tuần, analytics một tenant 30 ngày lọc app, trang bản ghi platform 30 ngày. In số thật.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import { type AnalyticsCall, getAnalytics } from "./analytics.service";
import { getRecords } from "./records.service";

const N = 1_000_000;
const P95_MS = 300;
const T = [1, 2, 3, 4].map(
  (n) => `a4900000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
);
let owner: Sql;
let db: Db;
let seedMs = 0;
let rollupRows = 0;

const daysAgo = (n: number) =>
  new Date(Date.now() + 7 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);
const platform = (): AnalyticsCall => ({
  ctx: { db, now: () => new Date() },
  actor: {
    userId: T[0] as string,
    tenantId: T[0] as string,
    tenantKey: "p0",
    role: "platform_admin",
    sid: null,
  },
  scope: { kind: "platform" },
});

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(1);
  db = createDb(withCreds(urls().owner, "admin_api", "admin_api_dev_pw"), { max: 2 });
  await owner`insert into admin.tenants (id, key, name) select id, 'p' || i, 'P ' || i
    from unnest(${T}::uuid[]) with ordinality as x(id, i)`;
  const t0 = performance.now();
  await owner`insert into hub.usage_logs (tenant_id, run_id, user_id, agent_id, feature, app, provider_key, model,
      billing, input_tokens, output_tokens, cache_read_tokens, cost_usd, latency_ms, outcome, at)
    select (${T}::uuid[])[1 + x.u % 4],
      ('b0000000-0000-4000-8000-' || lpad((g / 3)::text, 12, '0'))::uuid,
      ('c0000000-0000-4000-8000-' || lpad(x.u::text, 12, '0'))::uuid,
      ('d0000000-0000-4000-8000-' || lpad(x.a::text, 12, '0'))::uuid,
      case when x.a % 5 = 0 then 'chat'
        else (array['chat', 'contracts', 'knowledge', 'process', 'rooms'])[1 + x.a % 5] || '.x' end,
      (array['chat', 'contracts', 'knowledge', 'process', 'rooms'])[1 + x.a % 5],
      'anthropic', (array['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])[1 + x.a % 3], 'api',
      500 + g % 1000, 50 + g % 300, g % 100, 0.001 * (1 + g % 7), 200 + g % 4000,
      case when g % 20 = 0 then 'error' else 'ok' end,
      now() - make_interval(days => (g % 90)::int, secs => (g % 3600)::double precision)
    from generate_series(1, ${N}::int) g, lateral (select g % 200 as u, ((g % 200) * 2 + g % 2) % 24 as a) x`;
  seedMs = performance.now() - t0;
  await owner`analyze hub.usage_daily`;
  const [r] = await owner<{ n: number }[]>`select count(*)::int as n from hub.usage_daily`;
  rollupRows = r?.n ?? 0;
}, 900_000);

afterAll(async () => {
  await db.close();
  await owner.end({ timeout: 1 });
});

async function p95(fn: () => Promise<unknown>): Promise<number> {
  for (let i = 0; i < 2; i++) await fn();
  const ms: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[Math.ceil(ms.length * 0.95) - 1] as number;
}

describe("ADM-FR-42 · usage-analytics perf (1M dòng)", () => {
  test("analytics + bản ghi p95 ≤ 300 ms", async () => {
    const all = await p95(() =>
      getAnalytics(platform(), { from: daysAgo(89), to: daysAgo(0), grain: "week" }),
    );
    const one = await p95(() =>
      getAnalytics(platform(), {
        tenant_id: T[0],
        from: daysAgo(29),
        to: daysAgo(0),
        app: "contracts",
      }),
    );
    const recs = await p95(() =>
      getRecords(platform(), { from: daysAgo(29), to: daysAgo(0), limit: 50 }),
    );
    console.log(
      `usage-analytics perf: seed ${N} dòng ${Math.round(seedMs)} ms, usage_daily ${rollupRows} dòng; p95 analytics all/90d ${all.toFixed(1)} ms, tenant/30d ${one.toFixed(1)} ms, records ${recs.toFixed(1)} ms`,
    );
    const [s] = await owner<{ n: string }[]>`select sum(calls)::text as n from hub.usage_daily`;
    expect(Number(s?.n)).toBe(N); // tổng hợp khớp số dòng thô
    expect({ all: all <= P95_MS, one: one <= P95_MS, recs: recs <= P95_MS }).toEqual({
      all: true,
      one: true,
      recs: true,
    });
  }, 300_000);
});
