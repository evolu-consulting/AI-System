// CR-122 · E1b · Luật 4c · perf: 1000 sự kiện (5 công ty × 3 flow đang bật, một có điều kiện) qua `dispatchOnce` lô 100 —
// đo từng lô (launch giả ⇒ đo riêng chi phí bộ điều phối: nhận lô + ứng viên + cờ + chốt). Ngưỡng: p95 lô ≤ 100 ms (≈ 1 ms/sự kiện),
// tổng 1000 sự kiện ≤ 2 s. In số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";

const TENANTS = Array.from({ length: 5 }, (_, i) => tenantId(1270 + i));
const U = userId(1270);
const N = 1000;
let o: Sql;
let db: Db;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  for (const [i, t] of TENANTS.entries()) {
    await o`insert into admin.tenants (id, key, name) values (${t}, ${`t127${i}`}, ${`T${i}`})`;
    for (const [j, when] of [
      null,
      null,
      { op: "and", conds: [{ fact: "n", op: "ge", value: 500 }] },
    ].entries()) {
      const trig = { event: "contract.approved", ...(when ? { when } : {}) };
      const [d] = await o<
        { id: string }[]
      >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
        values (${t}, ${`perf-${j}`}, ${`P${j}`}, '[{"key":"a"}]'::jsonb, ${o.json(trig as never)}, 'contracts') returning id::text as id`;
      await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${t}, ${d?.id as string}, true, ${j})`;
    }
    await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, t, true));
  }
  await o`insert into hub.flow_events (tenant_id, event_id, event, ref, facts, actor_id)
    select (${o.array(TENANTS)}::uuid[])[1 + (g % 5)], 'perf:' || g, 'contract.approved', 'r-' || g,
      jsonb_build_object('n', g), ${U}::uuid from generate_series(1, ${N}) g`;
  await o`analyze hub.flow_events`;
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 E1b · perf dispatchOnce", () => {
  it(`${N} sự kiện, lô 100: p95 lô ≤ 100 ms, tổng ≤ 2 s`, async () => {
    let launched = 0;
    const launch = async () => {
      launched++;
      return { runId: "x" };
    };
    const now = new Date(Date.now() + 60_000);
    const ms: number[] = [];
    const t0 = performance.now();
    for (;;) {
      const s = performance.now();
      const r = await dispatchOnce({ db, launch, now: () => now, batch: 100 });
      if (r.claimed === 0) break;
      ms.push(performance.now() - s);
    }
    const total = performance.now() - t0;
    const sorted = [...ms].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
    console.log(
      `perf dispatchOnce: lô=${ms.length} p95=${p95.toFixed(1)}ms tổng=${total.toFixed(0)}ms launched=${launched}`,
    );
    const [left] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.flow_events where processed_at is null`;
    expect(left?.n).toBe(0);
    expect(launched).toBe(N * 2 + 501); // 2 flow không điều kiện + flow điều kiện n ≥ 500
    expect(p95).toBeLessThanOrEqual(100);
    expect(total).toBeLessThanOrEqual(2_000);
  }, 60_000);
});
