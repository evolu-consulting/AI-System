// CR-124 · q1 · NFR-03 · Luật 4c · bộ chuyển hộp thư theo lô: số câu SQL mỗi lô CỐ ĐỊNH (lô 5 dòng = lô 100 dòng) và 1000 lần
// gửi + 1000 trả lời qua lô 100: p95 lô ≤ 50 ms (mục tiêu local). In số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { captureSql, percentile } from "@ai/test-kit/perf";
import { connectDb, type Db } from "../../lib/db";
import { partnerMoveOnce } from "./mailbox-mover";

const TENANTS = Array.from({ length: 10 }, (_, i) => tenantId(1310 + i));
const N = 1000;
let o: Sql;
let db: Db;
const client = (): Sql => (db.db as unknown as { $client: Sql }).$client;

/** `n` lần gửi kênh nền tảng giữa các công ty (dựng bằng owner — chỉ dữ liệu, đường hàm đã có test riêng). */
const seed = (n: number, tag: string) => o`
  insert into hub.partner_mailbox (from_tenant, to_tenant, channel, from_ref, payload, expires_at)
  select t[1 + (g % 10)], t[1 + ((g + 1) % 10)], 'platform', ${tag} || g, '{"message":"m"}'::jsonb,
    now() + interval '7 days'
  from generate_series(1, ${n}) g, (select ${`{${TENANTS.join(",")}}`}::uuid[] as t) x`;

async function drain(): Promise<number[]> {
  const ms: number[] = [];
  for (;;) {
    const s = performance.now();
    const r = await partnerMoveOnce({ db, batch: 100 });
    if (r.delivered + r.replied === 0) break;
    ms.push(performance.now() - s);
  }
  return ms;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-124 q1 · NFR-03 perf bộ chuyển", () => {
  it("số câu SQL mỗi lô không phụ thuộc số dòng", async () => {
    await partnerMoveOnce({ db }); // làm nóng câu chuẩn bị
    await seed(5, "small-");
    const small = (await captureSql(client(), () => partnerMoveOnce({ db, batch: 100 }))).queries
      .length;
    await seed(100, "big-");
    const big = (await captureSql(client(), () => partnerMoveOnce({ db, batch: 100 }))).queries
      .length;
    console.log(`perf partner mover: câu SQL/lô 5 dòng=${small} 100 dòng=${big}`);
    expect(big).toBe(small);
    expect(big).toBeLessThanOrEqual(3);
  });

  it(`${N} gửi + ${N} trả lời, lô 100: p95 lô ≤ 50 ms`, async () => {
    await seed(N, "p-");
    await o`analyze hub.partner_mailbox`;
    const t0 = performance.now();
    const send = await drain();
    await o`update hub.partner_mailbox set status = 'replied', outcome = 'confirmed', replied_by_source = 'receiver_flow',
      replied_at = now() where status = 'delivered'`;
    const rep = await drain();
    const total = performance.now() - t0;
    const all = [...send, ...rep];
    const p95 = percentile(all, 95);
    console.log(
      `perf partner mover: lô=${all.length} p50=${percentile(all, 50).toFixed(1)}ms p95=${p95.toFixed(1)}ms ` +
        `max=${Math.max(...all).toFixed(1)}ms tổng=${total.toFixed(0)}ms`,
    );
    const [left] = await o<{ n: number }[]>`select count(*)::int as n from hub.partner_mailbox
      where status = 'sent' or (status = 'replied' and reply_emitted_at is null)`;
    expect(left?.n).toBe(0);
    const [ev] = await o<
      { n: number }[]
    >`select count(*)::int as n from hub.flow_events where event_id like 'partner:%'`;
    expect(ev?.n).toBe(2 * (N + 105));
    expect(p95).toBeLessThanOrEqual(50);
  }, 60_000);
});
