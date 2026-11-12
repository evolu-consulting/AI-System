// CR-127 · E6 · Luật 4c · spec §9 · perf vòng lịch: 10.000 HĐ `done` tới hạn trong cửa sổ N=30 của MỘT quy trình ⇒ `scheduleSweepOnce`
// lô 100 (100 trang). Ngưỡng: p95 mỗi trang (nguồn + phát) ≤ 50 ms; số câu SQL mỗi trang ≤ 4 (không tính câu đặt scope/role, BEGIN/COMMIT);
// chạy lần 2 cùng ngày ⇒ 0 sự kiện mới. In số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { contractsScheduledSource } from "../../packs/contracts/schedule-sources.mount";
import type { ScheduledSource } from "../../packs/kit/public";
import { scheduleSweepOnce } from "./schedule-sweep";

const T = tenantId(1350);
const N = 10_000;
const TODAY = "2026-12-01";
let o: Sql;
let db: Db;

const SKIP =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\(|select current_user|select b\.oid, b\.typarray from pg_catalog\.pg_type)/i;
type Opts = { debug?: (c: number, q: string, ...r: unknown[]) => void };
function counter(d: Db) {
  type C = { $client?: { options: Opts } };
  const x = d as unknown as C & { db?: C };
  const opts = (x.db?.$client ?? x.$client)?.options as Opts; // `connectDb` ⇒ drizzle trên postgres.js
  let n = 0;
  const prev = opts.debug;
  opts.debug = (c, q, ...r) => {
    if (typeof prev === "function") prev(c, q, ...r);
    if (!SKIP.test(q)) n++;
  };
  const off = () => {
    opts.debug = prev;
  };
  return { get: () => n, off };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1350', 'T')`;
  const [u] = (await users(o, T, 1, { from: 1350 })) as [string];
  await o`insert into contracts.contracts (tenant_id, title, status, created_by, owner_user_id, extract_state, effect, fields)
    select ${T}::uuid, 'HD ' || g, 'done', ${u}::uuid, ${u}::uuid, 'ready', 'expiring',
      jsonb_build_object('end_date', jsonb_build_object('value', (${TODAY}::date + (g % 30))::text),
        'total_value', jsonb_build_object('value', g * 1000))
    from generate_series(1, ${N}) g`;
  const trig = { event: "contract.expiring", params: { days: 30 } };
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
    values (${T}, 'perf-exp', 'P', '[{"key":"a"}]'::jsonb, ${o.json(trig as never)}, 'contracts') returning id::text as id`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${T}, ${d?.id as string}, true, 0)`;
  await o`analyze contracts.contracts`;
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E6 · perf scheduleSweepOnce", () => {
  it(`${N} HĐ, lô 100: p95 trang ≤ 50 ms, ≤ 4 câu/trang, chạy lại 0 mới`, async () => {
    const src = contractsScheduledSource(db);
    const starts: number[] = [];
    const srcMs: number[] = [];
    const timed: ScheduledSource = {
      ...src,
      dueRecords: async (q) => {
        const s = performance.now();
        starts.push(s);
        const out = await src.dueRecords(q);
        srcMs.push(performance.now() - s);
        return out;
      },
    };
    const sourceFor = () => timed;
    await scheduleSweepOnce({ db, today: "2026-01-01", batch: 100, sourceFor }); // làm nóng (ngoài cửa sổ ⇒ 0)
    starts.length = 0;
    const c = counter(db);
    const t0 = performance.now();
    const r = await scheduleSweepOnce({ db, today: TODAY, batch: 100, sourceFor });
    const end = performance.now();
    const queries = c.get();
    c.off();
    const ms = starts.map((s, i) => (starts[i + 1] ?? end) - s);
    const sorted = [...ms].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
    const perPage = (queries - 1) / starts.length; // −1: câu liệt kê quy trình lịch của lượt
    console.log(
      `perf schedule-sweep: trang=${starts.length} p95=${p95.toFixed(1)}ms tổng=${(end - t0).toFixed(0)}ms câu=${queries} câu/trang=${perPage.toFixed(2)} phát=${r.emitted} nguồn p95=${[...srcMs].sort((a, b) => a - b)[Math.ceil(srcMs.length * 0.95) - 1]?.toFixed(1)}ms`,
    );
    expect(r.emitted).toBe(N);
    expect(p95).toBeLessThanOrEqual(50);
    expect(perPage).toBeLessThanOrEqual(4);
    const again = await scheduleSweepOnce({ db, today: TODAY, batch: 100, sourceFor });
    expect(again.emitted).toBe(0);
  }, 120_000);
});
