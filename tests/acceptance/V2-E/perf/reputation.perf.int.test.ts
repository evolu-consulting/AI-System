// V2-E · Luật 4c · ngưỡng intake §3: bảng điểm v2 `GET /reputation/partners` cho 1.000 đối tác × 3 vai p95 ≤ 100 ms (sau ANALYZE),
// số câu SQL cố định. Dữ liệu: 3.000 HĐ đã xác nhận × 5 mốc = 15.000 mốc rải 20 tháng, 2.000 việc ghi tay, 1.000 lượt chấm (acme) +
// cùng cỡ ở beta làm nền. Chỉ chạy dưới `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type Cap,
  captureSql,
  getWith,
  inPack,
  literalize,
  measure,
  ROLE_RW,
} from "../../HD1/_support/hd1";
import { seedBoard } from "../_support/seed";
import { arrangeV2e, BASE_R, type CtxN1, P, startHd1, T } from "../_support/v2e";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const N = 1_000;
const K = 5;

describe("V2-E · bảng điểm v2 1.000 đối tác × 3 vai", () => {
  it("p95 ≤ 100 ms: /reputation/partners, ?role=customer, /reputation/partner (sau ANALYZE); số câu cố định", async () => {
    await arrangeV2e(c);
    await seedBoard(c.sql, T.acme, N, K);
    await seedBoard(c.sql, T.beta, N, K);
    await c.sql`analyze contracts.contracts, contracts.obligations, contracts.partner_events, contracts.score_ratings`;
    const token = await c.tok(P.hoa);
    const paths = [
      "/partners",
      "/partners?role=customer",
      `/partner?party=${encodeURIComponent("tax:0500000002")}&role=customer`,
    ];
    const first = await getWith(c, token, `${BASE_R}/partners`);
    expect(first.json.length).toBe(N * 3);
    const { queries, r } = await captureSql(c, () => getWith(c, token, `${BASE_R}/partners`));
    console.log(
      `V2-E /reputation/partners: ${queries.length} câu SQL · ${(r.text.length / 1024).toFixed(0)} KB`,
    );
    expect(queries.length).toBe(6);
    // Thời gian từng CÂU (role gói + RLS thật, JIT tắt như `withPackScope`) để tách khỏi TS/JSON/HTTP.
    const agg = queries.find((q) => q.text.includes("ms0 as materialized")) as Cap;
    const facts = queries.find((q) => q.text.includes("cv0 as materialized")) as Cap;
    const sqlOf = async (cap: Cap, label: string) => {
      const ms: number[] = [];
      const plan = await inPack(
        T.acme,
        async (tx) => {
          await tx.unsafe("select set_config('jit', 'off', true)");
          for (let i = 0; i < 30; i++) {
            const t0 = performance.now();
            await tx.unsafe(literalize(cap));
            ms.push(performance.now() - t0);
          }
          return (await tx.unsafe(
            `explain (analyze, format text) ${literalize(cap)}`,
          )) as unknown as {
            "QUERY PLAN": string;
          }[];
        },
        ROLE_RW,
      );
      ms.sort((a, b) => a - b);
      console.log(`V2-E câu ${label}: p50 ${ms[15]?.toFixed(1)} ms · p95 ${ms[28]?.toFixed(1)} ms`);
      if (process.env.V2E_PERF_PLAN) console.log(plan.map((x) => x["QUERY PLAN"]).join("\n"));
    };
    await sqlOf(agg, "gom việc");
    await sqlOf(facts, "HĐ + sao + danh bạ");
    for (const path of paths) {
      const st = await measure(c, () => getWith(c, token, `${BASE_R}${path}`), { n: 60 });
      console.log(
        `V2-E GET ${path}: p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      expect(st.p95).toBeLessThanOrEqual(100);
    }
  }, 300_000);
});
