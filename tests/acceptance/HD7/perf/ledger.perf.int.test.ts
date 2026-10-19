// HD7-NFR-03 · HD7-AC08 · Luật 4c: vòng quá hạn lô 500 trên 10.000 đợt quá hạn (acme) + 10.000 đợt nền (beta) — p95 ≤ 50 ms,
// 2 câu/lô, không Seq Scan `obligations`; `GET /payments` p95 ≤ 50 ms trên cùng dữ liệu. Đo trước/sau ANALYZE. Chỉ chạy dưới
// `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { literalize, type PlanNode, seqScansIn } from "@ai/test-kit/perf";
import { getWith, inPack, measure, percentile, ROLE_RW } from "../../HD1/_support/hd1";
import {
  arrangeHd7,
  BASE,
  type CtxN1,
  P,
  type Sql,
  startHd1,
  startSweep,
  T,
} from "../_support/hd7";

const N = 10_000;
const BATCH = 500;
let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** N HĐ đã duyệt (mỗi HĐ một đợt) cho `tenant`: nửa thu, nửa trả, hạn rải 2026-01-01…2026-09-30, đều có đối tác. */
async function seed(sql: Sql, tenant: string) {
  await sql`insert into contracts.contracts (id, tenant_id, title, direction, status, created_by, fields)
    select gen_random_uuid(), ${tenant}, 'HĐ ' || g, case when g % 2 = 0 then 'sale' else 'purchase' end, 'active',
      ${P.lan.id}, jsonb_build_object('number', jsonb_build_object('value', 'P-' || g),
        'buyer_name', jsonb_build_object('value', 'Khách ' || (g % 400)),
        'supplier_name', jsonb_build_object('value', 'NCC ' || (g % 400)))
    from generate_series(1, ${N}) g`;
  await sql`insert into contracts.obligations (tenant_id, contract_id, party_key, direction, seq, due_date, amount)
    select ${tenant}, c.id, 'name:khach ' || (row_number() over () % 400),
      case when c.direction = 'sale' then 'receive' else 'pay' end, 1,
      date '2026-01-01' + ((row_number() over ())::int % 270), 1000000 + (row_number() over ())::bigint
    from contracts.contracts c where c.tenant_id = ${tenant}`;
}

async function seqScans(tid: string, q: { text: string; params: unknown[] }): Promise<string[]> {
  return inPack(
    tid,
    async (tx) => {
      const rows = (await tx.unsafe(`explain (format json) ${literalize(q)}`)) as unknown as {
        "QUERY PLAN": { Plan: PlanNode }[];
      }[];
      return seqScansIn(rows[0]?.["QUERY PLAN"]?.[0]?.Plan as PlanNode, [
        "obligations",
        "contracts",
      ]);
    },
    ROLE_RW,
  );
}

describe("HD7-NFR-03 · vòng quá hạn", () => {
  for (const analyzed of [false, true]) {
    it(`lô ${BATCH} p95 ≤ 50 ms, 2 câu/lô, không Seq Scan (${analyzed ? "sau" : "trước"} ANALYZE)`, async () => {
      await arrangeHd7(c);
      await seed(c.sql, T.acme);
      await seed(c.sql, T.beta);
      if (analyzed) await c.sql`analyze contracts.obligations`;
      const s = startSweep({ at: "2026-10-10T03:00:00Z", tenants: [T.acme], batch: BATCH });
      try {
        const ms: number[] = [];
        let first: { text: string; params: unknown[] } | undefined;
        for (let i = 0; i < N / BATCH; i++) {
          const t0 = performance.now();
          const r = await s.count(() => s.s.once(T.acme));
          ms.push(performance.now() - t0);
          expect([r.r, r.n]).toEqual([BATCH, 2]);
          first ??= r.queries.at(-1);
        }
        expect(await s.s.once(T.acme)).toBe(0);
        const p95 = percentile(ms, 95);
        console.log(
          `HD7 overdue lô ${BATCH} (${analyzed ? "sau" : "trước"} ANALYZE): p50 ${percentile(ms, 50).toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · max ${Math.max(...ms).toFixed(1)} ms`,
        );
        expect(await seqScans(T.acme, first as { text: string; params: unknown[] })).toEqual([]);
        expect(p95).toBeLessThanOrEqual(50);
      } finally {
        await s.stop();
      }
    }, 180_000);
  }
});

describe("HD7-NFR-03 · GET /payments", () => {
  it("p95 ≤ 50 ms trên 10.000 đợt (+ nền beta), sau ANALYZE", async () => {
    await arrangeHd7(c);
    await seed(c.sql, T.acme);
    await seed(c.sql, T.beta);
    await c.sql`analyze contracts.obligations`;
    const token = await c.tok(P.hoa);
    for (const f of ["all", "overdue", "done"]) {
      const st = await measure(c, () => getWith(c, token, `${BASE}/payments?filter=${f}`));
      console.log(
        `HD7 GET /payments?filter=${f}: p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      expect(st.p95).toBeLessThanOrEqual(50);
    }
  }, 180_000);
});
