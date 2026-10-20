// V2-D · Luật 4c · intake §3: xác nhận một mốc giao 20 dòng qua HTTP (`POST /obligations/:id/settle`) — p95 ≤ 50 ms, số câu cố
// định. Nền: 2.000 SP (mỗi SP 1 thành phần, 5 lô + 5 dòng sổ) ở acme + beta; lượt chẵn Mua 5/dòng, lượt lẻ Bán 5/dòng (tồn ổn định).
// Mốc mới tạo trong `before` (không tính giờ). Chỉ chạy dưới `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { measure } from "../../HD1/_support/hd1";
import {
  addDelivery,
  arrangeV2d,
  type CtxN1,
  call,
  d,
  deal,
  item,
  P,
  type PlanRow,
  type Sql,
  startHd1,
  T,
} from "../_support/v2d";

const LINES = 20;
let c: CtxN1;
let ps: string[] = [];

async function seed(sql: Sql, tenant: string): Promise<string[]> {
  await sql`insert into contracts.products (tenant_id, name, unit, grp)
    select ${tenant}::uuid, 'SP nền ' || g, 'cái', 'goods' from generate_series(1, 2000) g`;
  await sql`insert into contracts.product_components (tenant_id, product_id, ord, name, mode, on_hand, stock_value, avg_cost)
    select p.tenant_id, p.id, 0, p.name, 'stock', 500000, 5000000000, 10000
    from contracts.products p where p.tenant_id = ${tenant}::uuid`;
  await sql`insert into contracts.stock_lots (id, tenant_id, component_id, qty, remaining, received_on)
    select gen_random_uuid(), x.tenant_id, x.id, 100000, 100000, date '2026-01-01' + k
    from contracts.product_components x, generate_series(0, 4) k where x.tenant_id = ${tenant}::uuid`;
  await sql`insert into contracts.stock_moves (id, tenant_id, component_id, lot_id, direction, qty, unit_cost, amount,
      on_hand_before, on_hand_after, value_before, value_after, avg_before, avg_after, moved_on)
    select gen_random_uuid(), l.tenant_id, l.component_id, l.id, 'in', l.qty, 10000, 1000000000, 0, 100000, 0, 1000000000,
      0, 10000, l.received_on
    from contracts.stock_lots l where l.tenant_id = ${tenant}::uuid`;
  return (
    await sql<{ id: string }[]>`select id::text from contracts.products
      where tenant_id = ${tenant}::uuid order by name limit ${LINES}`
  ).map((r) => r.id);
}

async function contract(sale: boolean, products: string[]): Promise<[string, PlanRow[]]> {
  const k = await deal(c.sql, { sale, end: d(365) });
  const rows: PlanRow[] = [];
  for (const p of products)
    rows.push({ item_id: await item(c.sql, k, { qty: 1e9, price: 11_000, productId: p }), qty: 5 });
  return [k, rows];
}

beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
  ps = await seed(c.sql, T.acme);
  await seed(c.sql, T.beta);
}, 300_000);
afterAll(async () => {
  await c?.stop();
});

describe("V2-D · xác nhận mốc giao 20 dòng (HTTP)", () => {
  for (const analyzed of [false, true]) {
    it(`p95 ≤ 50 ms (${analyzed ? "sau" : "trước"} ANALYZE)`, async () => {
      if (analyzed)
        await c.sql`analyze contracts.product_components, contracts.stock_lots, contracts.stock_moves,
          contracts.products, contracts.contract_items, contracts.milestone_items, contracts.obligations`;
      // HĐ mới mỗi ca: trần 200 mốc/HĐ (V2-A) — mỗi HĐ nhận ~105 mốc.
      const [buy, planBuy] = await contract(false, ps);
      const [sell, planSell] = await contract(true, ps);
      let m = "";
      const st = await measure(
        c,
        () => call(c, P.hoa, "POST", `/obligations/${m}/settle`, { at: d(0) }),
        {
          n: 200,
          before: async (i) => {
            const isBuy = Math.abs(i) % 2 === 0;
            m = await addDelivery(c, isBuy ? buy : sell, isBuy ? planBuy : planSell);
          },
        },
      );
      console.log(
        `V2-D xác nhận mốc giao 20 dòng HTTP (${analyzed ? "sau" : "trước"} ANALYZE): p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      expect(st.p95).toBeLessThanOrEqual(50);
    }, 300_000);
  }
});
