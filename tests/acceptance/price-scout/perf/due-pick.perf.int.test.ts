// price-scout · Luật 4c: câu nhận lô của vòng dò theo lịch (`claimSql` — MỘT câu, `FOR UPDATE SKIP LOCKED`, giới hạn theo lượt
// đang chạy + trần ngày/tháng) trên 100.000 SP tới hạn của một tenant (+ 100.000 SP nền ở tenant khác, nửa không theo lịch):
// p95 ≤ 50 ms sau ANALYZE; tìm tenant tới hạn (role job) cũng ≤ 50 ms. Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { percentile } from "@ai/test-kit/perf";
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import {
  claimSql,
  scoutDueFinder,
} from "../../../../apps/hub-api/src/modules/packs/contracts/adapters/price-scout-schedule.repo";
import { HUB_API_URL } from "../../H1/_fixtures";
import { T } from "../../V2-J2/_support/v2j2";
import { setupX2a } from "../../X2a/_x2a";

type Sql = Awaited<ReturnType<typeof setupX2a>>;
let sql: Sql;
let db: ReturnType<typeof connectDb>;
const N = 100_000;

async function seed(tenant: string, scheduled: boolean) {
  await sql`insert into contracts.products (tenant_id, name, unit, grp)
    select ${tenant}, 'SP dò ' || g, 'cái', 'goods' from generate_series(1, ${N}::int) g`;
  await sql`insert into contracts.product_components (tenant_id, product_id, ord, name, mode, avg_cost)
    select p.tenant_id, p.id, 0, p.name, 'stock', 100000 from contracts.products p where p.tenant_id = ${tenant}`;
  await sql`insert into contracts.price_scout_configs (tenant_id, product_id, cfg, next_at)
    select p.tenant_id, p.id, '{}'::jsonb,
      case when ${scheduled}::boolean or (hashtext(p.name) % 2 = 0) then now() - (hashtext(p.name) % 1000) * interval '1 minute' end
    from contracts.products p where p.tenant_id = ${tenant}`;
}

beforeAll(async () => {
  sql = await setupX2a();
  db = connectDb(HUB_API_URL, 4);
  await sql`truncate contracts.products cascade`;
  await sql`truncate contracts.price_scout_usage, contracts.price_scout_quota, contracts.price_scout_defaults`;
  await seed(T.acme, true);
  await seed(T.beta, false);
  await sql`analyze contracts.products`;
  await sql`analyze contracts.price_scout_configs`;
}, 600_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

const L = { concurrency: 4, daily: 1_000_000, systemSearches: 1_000_000, leaseS: 300 };

describe("price-scout · nhận lô SP tới hạn trên 100.000 SP", () => {
  it("p95 claim ≤ 50 ms, p95 tìm tenant ≤ 50 ms", async () => {
    const times: number[] = [];
    const finds: number[] = [];
    const finder = scoutDueFinder(db, "contracts");
    const today = new Date().toISOString().slice(0, 10);
    const m = `${today.slice(0, 7)}-01`;
    for (let i = 0; i < 60; i++) {
      const now = new Date().toISOString();
      const t0 = performance.now();
      const got = await withPackScope(
        db,
        { packKey: "contracts", tenantId: T.acme, userId: null },
        (tx) => tx.execute<{ j: unknown[] }>(claimSql(T.acme, { now, today, m }, L)),
      );
      times.push(performance.now() - t0);
      expect(((got[0]?.j ?? []) as unknown[]).length).toBe(4);
      // gỡ lease (mô phỏng lô xong) để lượt sau lại có chỗ
      await sql`update contracts.price_scout_configs set lease_until = null, next_at = now() + interval '7 days'
        where tenant_id = ${T.acme} and lease_until is not null`;
      const f0 = performance.now();
      expect(await finder.next(now, [])).toBeTruthy();
      finds.push(performance.now() - f0);
    }
    const p95 = percentile(times.slice(10), 95);
    const f95 = percentile(finds.slice(10), 95);
    console.log(
      `price-scout claim p95 ${p95.toFixed(1)} ms · finder p95 ${f95.toFixed(1)} ms (N=${N}/tenant)`,
    );
    expect(p95).toBeLessThanOrEqual(50);
    expect(f95).toBeLessThanOrEqual(50);
  }, 600_000);
});
