// MS-impact · Luật 4c: `GET /obligations/:id/impact` (một đối tác × một vai) p95 ≤ 100 ms, số câu SQL cố định, trên nền V2-E 1.000 đối
// tác × 3 vai × 5 mốc (acme + beta). Đo cả hai engine (cờ `REPUTATION_ENGINE`). Chỉ chạy dưới `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { captureSql, getWith, measure } from "../../HD1/_support/hd1";
import { seedBoard } from "../../V2-E/_support/seed";
import { arrangeV2e, type CtxN1, d, P, startHd1, T } from "../../V2-E/_support/v2e";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  delete process.env.REPUTATION_ENGINE;
  await c?.stop();
});

describe("MS-impact · xem trước tác động 1 mốc (nền 1.000 đối tác × 3 vai)", () => {
  it("p95 ≤ 100 ms mỗi engine; số câu cố định", async () => {
    await arrangeV2e(c);
    await seedBoard(c.sql, T.acme, 1_000, 5);
    await seedBoard(c.sql, T.beta, 1_000, 5);
    const [r] = await c.sql<
      { id: string }[]
    >`insert into contracts.obligations (tenant_id, contract_id, party_key,
        direction, kind, seq, due_date, status, owner, title)
      select c.tenant_id, c.id, 'tax:0500000002', 'pay', 'delivery', 99, ${d(-5)}, 'open', 'partner', 'Mốc mở'
      from contracts.contracts c where c.tenant_id = ${T.acme} and c.title = 'HĐ 2-0' returning id::text`;
    const m = (r as { id: string }).id;
    await c.sql`analyze contracts.contracts, contracts.obligations, contracts.partner_events, contracts.score_ratings`;
    const token = await c.tok(P.hoa);
    const path = `/pack/contracts/obligations/${m}/impact?fault=partner&actual_on=${d(0)}`;
    for (const engine of ["v2e", "hd8"] as const) {
      process.env.REPUTATION_ENGINE = engine;
      const first = await getWith(c, token, path);
      expect([first.status, first.json.reputation?.engine]).toEqual([200, engine]);
      const { queries } = await captureSql(c, () => getWith(c, token, path));
      const n = queries.filter((q) => !/set_config/.test(q.text)).length;
      const st = await measure(c, () => getWith(c, token, path), { n: 60 });
      console.log(
        `MS-impact GET impact (${engine}): ${n} câu · p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      // múi giờ tenant + đầu đợt + engine (V2-E: cấu hình + 2 câu chấm lọc đối tác; HD8: 3 câu song song của `partners.one`).
      expect(n).toBe(5);
      expect(st.p95).toBeLessThanOrEqual(100);
    }
  }, 300_000);
});
