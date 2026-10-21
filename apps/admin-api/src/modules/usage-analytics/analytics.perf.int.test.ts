// ADM-FR-42 · usage-analytics · Luật 4c: 1.000.000 dòng `hub.usage_logs` (90 ngày, 4 tenant, 200 user, 24 agent, 3 model,
// 5 app, 5% lỗi; dựng MỘT câu generate_series — trigger theo câu lệnh dựng `hub.usage_daily`). Ngưỡng p95 ≤ 300 ms mỗi
// endpoint (20 lần, in-process qua HTTP app, sau 2 lần làm nóng): analytics platform 90 ngày/tuần, analytics một tenant
// 30 ngày/ngày có lọc app, trang bản ghi platform. In số thật.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createM4Env, type M4Env, TENANT_ID, vnDate } from "../../../../../tests/acceptance/M4/_ab";

const N = 1_000_000;
const P95_MS = 300;
let env: M4Env;
let seedMs = 0;
let rollupRows = 0;

const daysAgo = (n: number) => vnDate(new Date(Date.now() - n * 86_400_000));

beforeAll(async () => {
  env = await createM4Env();
  await env.reset4();
  const t = [TENANT_ID.acme, TENANT_ID.globex, TENANT_ID.zeta, TENANT_ID.bulk];
  const t0 = performance.now();
  await env.owner`insert into hub.usage_logs (tenant_id, run_id, user_id, agent_id, feature, app, provider_key, model,
      billing, input_tokens, output_tokens, cache_read_tokens, cost_usd, latency_ms, outcome, at)
    select (${t}::uuid[])[1 + x.u % 4],
      ('b0000000-0000-4000-8000-' || lpad((g / 3)::text, 12, '0'))::uuid,
      ('c0000000-0000-4000-8000-' || lpad(x.u::text, 12, '0'))::uuid,
      ('a0000000-0000-4000-8000-' || lpad(x.a::text, 12, '0'))::uuid,
      case when x.a % 5 = 0 then 'chat' else (array['chat', 'contracts', 'knowledge', 'process', 'rooms'])[1 + x.a % 5]
        || '.x' end,
      (array['chat', 'contracts', 'knowledge', 'process', 'rooms'])[1 + x.a % 5],
      'anthropic', (array['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])[1 + x.a % 3], 'api',
      500 + g % 1000, 50 + g % 300, g % 100, 0.001 * (1 + g % 7), 200 + g % 4000,
      case when g % 20 = 0 then 'error' else 'ok' end,
      now() - make_interval(days => g % 90, secs => g % 3600)
    from generate_series(1, ${N}) g, lateral (select g % 200 as u, ((g % 200) * 2 + g % 2) % 24 as a) x`;
  seedMs = performance.now() - t0;
  const [r] = await env.owner<{ n: number }[]>`select count(*)::int as n from hub.usage_daily`;
  rollupRows = r?.n ?? 0;
}, 600_000);

afterAll(async () => {
  await env.owner`truncate hub.usage_logs`;
  await env.close();
});

async function p95(path: string): Promise<number> {
  for (let i = 0; i < 2; i++) expect((await env.as("GET", path)).status).toBe(200);
  const ms: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const r = await env.as("GET", path);
    ms.push(performance.now() - t0);
    expect(r.status).toBe(200);
  }
  ms.sort((a, b) => a - b);
  return ms[Math.ceil(ms.length * 0.95) - 1] as number;
}

describe("ADM-FR-42 · usage-analytics perf (1M dòng)", () => {
  test("analytics + bản ghi p95 ≤ 300 ms", async () => {
    const all = await p95(`/admin/usage/analytics?from=${daysAgo(89)}&to=${daysAgo(0)}&grain=week`);
    const one = await p95(
      `/admin/usage/analytics?tenant_id=${TENANT_ID.acme}&from=${daysAgo(29)}&to=${daysAgo(0)}&app=contracts`,
    );
    const recs = await p95(`/admin/usage/records?from=${daysAgo(29)}&to=${daysAgo(0)}&limit=50`);
    console.log(
      `usage-analytics perf: seed ${N} dòng ${Math.round(seedMs)} ms, usage_daily ${rollupRows} dòng; p95 analytics all/90d ${all.toFixed(1)} ms, tenant/30d ${one.toFixed(1)} ms, records ${recs.toFixed(1)} ms`,
    );
    const [s] = await env.owner<{ n: string }[]>`select sum(calls)::text as n from hub.usage_daily`;
    expect(Number(s?.n)).toBe(N); // tổng hợp khớp số dòng thô
    expect({ all: all <= P95_MS, one: one <= P95_MS, recs: recs <= P95_MS }).toEqual({
      all: true,
      one: true,
      recs: true,
    });
  }, 300_000);
});
