// CR-121 · cr121-c3a-overview-api · Luật 4c · perf `GET /ops/overview` (phần tính, KHÔNG cache): 10.000 lượt chạy giả (50 công ty, 7 ngày,
// đủ trạng thái) + 3.000 lần chạy Dify + 5.000 dòng dùng AI. Ngưỡng: p95 ≤ 300 ms; số câu SQL ≤ 8.
// Chạy: `deploy/evotest/run-tests.ps1 -Step perf -Filter apps/hub-api/src/modules/ops/ops.overview.perf.int.test.ts`. In dòng `OVERVIEW|…`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql, measure } from "@ai/test-kit/perf";
import { connectDb, type Db } from "../../lib/db";
import { makeOverviewService } from "./application/overview.service";
import { seedBase } from "./ops.overview.fixture";

const COMPANIES = 50;
const RUNS = 10_000;
const P95_MS = 300;
let o: Sql;
let db: Db;
const client = (): Sql => (db.db as unknown as { $client: Sql }).$client;
const fresh = () => makeOverviewService({ db }); // mỗi lượt một service ⇒ không dính cache

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name)
    select gen_random_uuid(), 'p' || i::text || 'x', 'Cty ' || i::text from generate_series(1, ${COMPANIES}::int) i`;
  const [first] = await o<{ id: string }[]>`select id::text as id from admin.tenants
    where key ~ '^p[0-9]+x$' order by id limit 1`;
  const b = await seedBase(o, first?.id as string, "perf");
  const ids = `(select array_agg(id order by id) from admin.tenants where key ~ '^p[0-9]+x$')`;
  await o.unsafe(
    `insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
       conversation_id, flow_id, status, expires_at, started_at, finished_at, updated_at)
     select (${ids})[1 + (i % ${COMPANIES})], $1::uuid, 1, '{}'::jsonb, $2::uuid, 'admin', 'x', $3::uuid,
       gen_random_uuid(), st, now() + interval '1 day', s,
       case when st in ('done', 'failed', 'expired') then s + interval '30 minutes' end, s
     from (select i,
             (array['done','done','done','done','failed','expired','running','waiting_review','needs_decision','cancelled'])[1 + (i % 10)] as st,
             now() - (random() * 7 * 86400) * interval '1 second' as s
           from generate_series(1, ${RUNS}) i) q`,
    [b.def, b.user, b.conv],
  );
  await o.unsafe(
    `insert into hub.dify_runs (tenant_id, workflow_id, trigger, status, created_at)
     select (${ids})[1], ('b2000000-0000-4000-8000-' || lpad((i % 40)::text, 12, '0'))::uuid, 'command',
       case when i % 7 = 0 then 'failed' else 'ok' end, now() - (random() * 7 * 86400) * interval '1 second'
     from generate_series(1, 3000) i`,
  );
  await o.unsafe(
    `insert into hub.usage_logs (tenant_id, run_id, billing, input_tokens, output_tokens, billable_usd, at)
     select (${ids})[1 + (i % ${COMPANIES})], gen_random_uuid(), 'api', 100, 50, 0.01,
       now() - (random() * 20 * 86400) * interval '1 second'
     from generate_series(1, 5000) i`,
  );
  await o.unsafe(
    `insert into admin.tenant_quotas (tenant_id, max_usd)
     select id, 5 from admin.tenants where key ~ '^p[0-9]+x$'`,
  );
  await o`analyze hub.process_runs`;
  await o`analyze hub.dify_runs`;
  await o`analyze hub.usage_logs`;
}, 600_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("GET /ops/overview · perf (Luật 4c)", () => {
  it("10.000 lượt chạy / 50 công ty: p95 ≤ 300 ms, ≤ 8 câu SQL", async () => {
    const q = { stuck_hours: 4, quota_pct: 80 };
    await fresh().get(q); // làm nóng kết nối (type-discovery của driver không phải câu nghiệp vụ)
    const sql = await captureSql(client(), () => fresh().get(q));
    expect(sql.queries.length).toBeLessThanOrEqual(8);
    expect(sql.r.kpi.runs.value).toBeGreaterThan(1000);
    const stat = await measure(() => fresh().get(q), { n: 30, warm: 3 });
    console.log(
      `OVERVIEW|runs=${RUNS}|companies=${COMPANIES}|sql=${sql.queries.length}|p50=${stat.p50.toFixed(1)}ms|p95=${stat.p95.toFixed(1)}ms|max=${stat.max.toFixed(1)}ms`,
    );
    expect(stat.p95).toBeLessThanOrEqual(P95_MS);
  });
});
