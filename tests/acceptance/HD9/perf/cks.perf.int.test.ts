// HD9-AC09 · Luật 4c · plan §5: p95 các route đọc CKS và lệnh bán 50 người giữ trên 20 lô / 400 khách / 2.000 chữ ký / 2.000 văn
// bản (acme) + nền beta cùng cỡ. Ngưỡng p95 ≤ 50 ms. Chỉ chạy dưới `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeCks,
  type CtxN1,
  d,
  getWith,
  jsonWith,
  KBASE,
  measure,
  P,
  startHd1,
  T,
} from "../_support/hd9";
import { seedCksPerf } from "../_support/seed";

let c: CtxN1;
let token = "";
let ready: Promise<string> | undefined;
const prepare = () =>
  (ready ??= (async () => {
    await arrangeCks(c);
    const t0 = performance.now();
    await seedCksPerf(c.sql, T.acme, P.lan.id);
    await seedCksPerf(c.sql, T.beta, P.an.id);
    console.log(
      `HD9 seed perf: 2 × (20 lô, 400 khách, 2.000 chữ ký, 2.000 văn bản) ${(performance.now() - t0).toFixed(0)} ms`,
    );
    token = await c.tok(P.hoa);
    const [k] = await c.sql<{ id: string }[]>`select id::text from contracts.cks_customers
      where tenant_id = ${T.acme} order by name limit 1`;
    return k?.id as string;
  })());
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("HD9-AC09 · p95", () => {
  for (const [name, path] of [
    ["overview", "/overview"],
    ["customers", "/customers"],
    ["customers lọc expiring", "/customers?filter=expiring"],
    ["lots", "/lots"],
    ["prices", "/prices"],
  ] as const) {
    it(`GET ${name} p95 ≤ 50 ms`, async () => {
      await prepare();
      const st = await measure(c, () => getWith(c, token, `${KBASE}${path}`));
      console.log(
        `HD9 ${name}: p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      expect(st.p95).toBeLessThanOrEqual(50);
    }, 120_000);
  }
  it("GET customers/:id + signed-docs p95 ≤ 50 ms", async () => {
    const id = await prepare();
    for (const path of [`/customers/${id}`, `/signed-docs?customer_id=${id}`]) {
      const st = await measure(c, () => getWith(c, token, `${KBASE}${path}`));
      console.log(
        `HD9 ${path.split("?")[0]}: p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms`,
      );
      expect(st.p95).toBeLessThanOrEqual(50);
    }
  }, 120_000);
  it("POST sales 50 người giữ p95 ≤ 50 ms", async () => {
    await prepare();
    const [lot] = await c.sql<
      { id: string }[]
    >`insert into contracts.cks_lots (tenant_id, label, ca, qty, unit_cost,
      bought_at, purchase_contract_id, created_by) values (${T.acme}, 'perf', 'Viettel-CA', 100000, 1000, ${d(-1)},
      gen_random_uuid(), ${P.lan.id}) returning id::text`;
    const st = await measure(
      c,
      (i) =>
        jsonWith(c, token, "POST", `${KBASE}/sales`, {
          company_name: `Perf ${i}`,
          lot_id: lot?.id,
          price_each: 1_500_000,
          signed_at: d(-1),
          valid_to: d(364),
          holders: Array.from({ length: 50 }, (_, h) => ({ name: `H${h}`, device: "token" })),
        }),
      { n: 60, okStatus: 201 },
    );
    console.log(
      `HD9 sales×50: p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
    );
    expect(st.p95).toBeLessThanOrEqual(50);
  }, 120_000);
});
