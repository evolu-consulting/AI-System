// HD-FR-51…55 · Luật 4c · HD5 plan "Perf": danh sách (thêm `parents`), chi tiết (thêm `parent`/`appendices`), bảng giá, gợi ý trên dữ liệu
// HD1 (3 tenant × 10.000 HĐ, mỗi HĐ thứ 20 là phụ lục của HĐ liền trước; 70.000 HĐ nền). Đo SAU ANALYZE: p95 + số câu SQL + EXPLAIN không
// Seq Scan trên contracts/contract_items. Chạy: `PERF=1 bun --config=bunfig.perf.toml test tests/acceptance/HD5/perf/`. Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CBASE,
  type CtxN1,
  captureSql,
  countHops,
  ensureRoles,
  getWith,
  measure,
  needContracts,
  P,
  seqScansOf,
  startHd1,
  T,
} from "../../HD1/_support/hd1";
import { analyzeAll, perfContractId, restoreAutovacuum, seedPerf } from "../../HD1/_support/seed";

let c: CtxN1;
let token = "";
beforeAll(async () => {
  c = await startHd1();
  await needContracts(c.sql);
  await ensureRoles(c);
  const s = await seedPerf(c.sql);
  console.log(`HD5 seed perf: ${s.rows.contracts} HĐ trong ${(s.ms / 1000).toFixed(1)} s`);
  await analyzeAll(c.sql);
  token = await c.tok(P.tam);
}, 600_000);
afterAll(async () => {
  await restoreAutovacuum(c.sql).catch(() => {});
  await c?.stop();
});

const parent = perfContractId(1, 19);
const appendix = perfContractId(1, 20);
const PATHS: Record<string, { path: string; max: number; sql: number }> = {
  "danh sách không lọc": { path: CBASE, max: 50, sql: 2 },
  "danh sách kind=appendix": { path: `${CBASE}?kind=appendix`, max: 50, sql: 2 },
  "danh sách trang cuối": { path: `${CBASE}?page=500&page_size=20`, max: 50, sql: 2 },
  "chi tiết HĐ gốc (có phụ lục)": { path: `${CBASE}/${parent}`, max: 30, sql: 2 },
  "chi tiết phụ lục (có HĐ gốc)": { path: `${CBASE}/${appendix}`, max: 30, sql: 2 },
  "bảng giá": { path: `${CBASE}/${parent}/prices`, max: 50, sql: 2 },
  "gợi ý HĐ gốc": { path: `${CBASE}/${appendix}/parent-suggestions`, max: 50, sql: 3 },
};

describe("HD5 perf · sau ANALYZE", () => {
  for (const [name, o] of Object.entries(PATHS)) {
    it(`${name}: p95 ≤ ${o.max} ms, ${o.sql} câu SQL, 0 Redis/HTTP`, async () => {
      const st = await measure(c, () => getWith(c, token, o.path));
      const h = await countHops(c, () => getWith(c, token, o.path));
      console.log(
        `HD5 perf · [${name}] p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(1)} ms (n=${st.n}, ngưỡng ${o.max}) · SQL=${h.sql}`,
      );
      expect({ status: h.r.status, sql: h.sql, http: h.http, redis: h.redis }).toEqual({
        status: 200,
        sql: o.sql,
        http: [],
        redis: [],
      });
      expect(st.p95).toBeLessThanOrEqual(o.max);
    }, 300_000);
  }

  it("EXPLAIN: không Seq Scan trên contracts/contract_items ở các câu HD5 mới/sửa", async () => {
    const found: Record<string, string[]> = {};
    for (const [name, o] of Object.entries(PATHS)) {
      const { queries } = await captureSql(c, () => getWith(c, token, o.path));
      const main = queries.filter((q) => !/^\s*select set_config/i.test(q.text));
      expect({ name, ran: main.length > 0 }).toEqual({ name, ran: true });
      const scans: string[] = [];
      for (const q of main) scans.push(...(await seqScansOf(T.acme, q)));
      found[name] = scans;
    }
    expect(found).toEqual(Object.fromEntries(Object.keys(PATHS).map((k) => [k, []])));
  }, 120_000);
});
