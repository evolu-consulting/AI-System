// HD-NFR-01 · HD-AC14 · Luật 4c · plan §6: danh sách + facets trên 3 tenant × 10.000 HĐ (5 item, 20 event, 50 loại) + tenant nền 70.000.
// p95 ≤ 50 ms MỌI tổ hợp lọc (kể cả không lọc, trang cuối), số câu SQL = 2, `EXPLAIN` không Seq Scan trên contracts/contract_items.
// Đo HAI pha: ngay sau seed (CHƯA có thống kê) và sau ANALYZE — cả hai phải đạt. Làm nóng = pool + 2 (D2-48), n = HD1_PERF_N (mặc định 200).
// Chỉ chạy trong `PERF=1 bun --config=bunfig.perf.toml test tests/acceptance/HD1/perf/` (không thuộc `test:int:par`). Báo số thật.
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
  PERF_N,
  seqScansOf,
  startHd1,
  T,
} from "../_support/hd1";
import { analyzeAll, perfCatId, restoreAutovacuum, seedPerf } from "../_support/seed";

let c: CtxN1;
let token = "";
let tokenB = "";
let ready: Promise<void> | undefined;
let seedMs = 0;
/** Nạp một lần; thiếu bảng ⇒ mọi ca đỏ NGAY cùng một lý do (không dựng dữ liệu). */
function prepare(): Promise<void> {
  ready ??= (async () => {
    await needContracts(c.sql);
    await ensureRoles(c);
    const s = await seedPerf(c.sql);
    seedMs = s.ms;
    console.log(
      `HD1 seed perf: ${s.rows.contracts} HĐ + ${s.rows.items} item + ${s.rows.events} event + ${s.rows.categories} loại hàng trong ${(s.ms / 1000).toFixed(1)} s (set-based, ${PERF_N} lượt/tổ hợp)`,
    );
    token = await c.tok(P.tam);
    tokenB = await c.tok(P.an);
  })();
  return ready;
}
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  if (ready) await restoreAutovacuum(c.sql).catch(() => {});
  await c?.stop();
});

const CAT = perfCatId(1, 7);
const enc = encodeURIComponent;
/** tổ hợp lọc → query string (acme = tenant 1; giá trị có thật trong dữ liệu đo). */
const COMBOS: Record<string, string> = {
  "không lọc": "",
  status: "?status=active",
  owner: `?owner=${P.lan.id}`,
  category: `?category=${CAT}`,
  seller: `?seller=${enc("Bên bán 7")}`,
  buyer: `?buyer=${enc("Bên mua 7")}`,
  signer: `?signer=${enc("người ký mua 7")}`,
  direction: "?direction=sale",
  kind: "?kind=appendix",
  value_min: "?value_min=500000000",
  "value khoảng": "?value_min=300000000&value_max=600000000",
  "status+owner+category": `?status=active&status=expiring&owner=${P.lan.id}&category=${CAT}`,
  "q 3 ký tự": "?q=ben",
  "q chọn lọc": `?q=${enc("hợp đồng 77")}`,
  "trang cuối": "?page=500&page_size=20",
  "page_size 100": "?page_size=100&page=50",
  "sort value asc": "?sort=value&dir=asc",
  "sort end_date desc": "?sort=end_date&dir=desc",
  "sort title": "?sort=title&dir=asc",
};
function runCombos(phase: string) {
  for (const [name, q] of Object.entries(COMBOS)) {
    it(`HD-NFR-01 · ${phase} · danh sách [${name}] p95 ≤ 50 ms, 2 câu SQL, có kết quả`, async () => {
      await prepare();
      const path = `${CBASE}${q}`;
      const st = await measure(c, () => getWith(c, token, path));
      const h = await countHops(c, () => getWith(c, token, path));
      const total = h.r.json?.total as number;
      console.log(
        `HD-NFR-01 · ${phase} · [${name}] p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(1)} ms (n=${st.n}, ngưỡng 50) · SQL=${h.sql} · total=${total}`,
      );
      expect({ sql: h.sql, http: h.http, redis: h.redis, hasRows: total > 0 }).toEqual({
        sql: 2,
        http: [],
        redis: [],
        hasRows: true,
      });
      expect(st.p95).toBeLessThanOrEqual(50);
    }, 300_000);
  }
  it(`HD-NFR-01 · ${phase} · facets p95 ≤ 50 ms, 2 câu SQL, 0 Redis, 0 HTTP nội bộ`, async () => {
    await prepare();
    const path = `${CBASE}/facets`;
    const st = await measure(c, () => getWith(c, token, path));
    const h = await countHops(c, () => getWith(c, token, path));
    console.log(
      `HD-NFR-01 · ${phase} · facets p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(1)} ms (n=${st.n}, ngưỡng 50) · SQL=${h.sql}`,
    );
    expect({ status: h.r.status, sql: h.sql, http: h.http, redis: h.redis }).toEqual({
      status: 200,
      sql: 2,
      http: [],
      redis: [],
    });
    expect(st.p95).toBeLessThanOrEqual(50);
  }, 300_000);
  it(`HD-NFR-01 · ${phase} · tenant beta (cùng bảng, 70.000 HĐ nền + 20.000 của tenant khác): danh sách không lọc và facets p95 ≤ 50 ms`, async () => {
    await prepare();
    const l = await measure(c, () => getWith(c, tokenB, CBASE));
    const f = await measure(c, () => getWith(c, tokenB, `${CBASE}/facets`));
    console.log(
      `HD-NFR-01 · ${phase} · beta danh sách p95=${l.p95.toFixed(2)} · facets p95=${f.p95.toFixed(2)} ms`,
    );
    expect(Math.max(l.p95, f.p95)).toBeLessThanOrEqual(50);
  }, 300_000);
}

describe("HD-NFR-01 · pha 1 — ngay sau seed, CHƯA ANALYZE", () => {
  it("HD-NFR-01 · tiền đề pha 1: bảng contracts chưa có thống kê (pg_stats rỗng)", async () => {
    await prepare();
    const [r] =
      await c.sql`select count(*)::int as n from pg_stats where schemaname = 'contracts' and tablename = 'contracts'`;
    expect({ stats: r?.n, seedUnder: seedMs > 0 }).toEqual({ stats: 0, seedUnder: true });
  });
  runCombos("trước ANALYZE");
});

describe("HD-NFR-01 · pha 2 — sau ANALYZE", () => {
  it("HD-NFR-01 · ANALYZE contracts/items/events/categories (có thống kê sau đó)", async () => {
    await prepare();
    const ms = await analyzeAll(c.sql);
    const [r] =
      await c.sql`select count(*)::int as n from pg_stats where schemaname = 'contracts' and tablename = 'contracts'`;
    console.log(`HD1 ANALYZE: ${(ms / 1000).toFixed(2)} s`);
    expect(r?.n).toBeGreaterThan(0);
  }, 120_000);
  runCombos("sau ANALYZE");
  it("HD-NFR-01 · EXPLAIN: KHÔNG Seq Scan trên contracts / contract_items — danh sách (6 tổ hợp), facets, chi tiết", async () => {
    await prepare();
    const ct =
      await c.sql`select id from contracts.contracts where tenant_id = ${T.acme} order by id limit 1`;
    const detailPath = `${CBASE}/${ct[0]?.id}`;
    const paths: Record<string, string> = {
      "không lọc": CBASE,
      category: `${CBASE}${COMBOS.category}`,
      "status+owner+category": `${CBASE}${COMBOS["status+owner+category"]}`,
      "q 3 ký tự": `${CBASE}${COMBOS["q 3 ký tự"]}`,
      "trang cuối": `${CBASE}${COMBOS["trang cuối"]}`,
      "sort value asc": `${CBASE}${COMBOS["sort value asc"]}`,
      facets: `${CBASE}/facets`,
      "chi tiết": detailPath,
    };
    const found: Record<string, string[]> = {};
    for (const [name, path] of Object.entries(paths)) {
      const { queries } = await captureSql(c, () => getWith(c, token, path));
      const main = queries.filter((q) => !/^\s*select set_config/i.test(q.text));
      expect({ name, nQueries: main.length > 0 }).toEqual({ name, nQueries: true });
      const scans: string[] = [];
      for (const q of main) scans.push(...(await seqScansOf(T.acme, q)));
      found[name] = scans;
    }
    expect(found).toEqual(Object.fromEntries(Object.keys(paths).map((k) => [k, []])));
  }, 120_000);
});
