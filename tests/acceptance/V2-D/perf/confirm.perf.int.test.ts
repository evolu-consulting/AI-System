// V2-D · Luật 4c · intake §3: xác nhận một mốc giao 20 dòng qua HTTP (`POST /obligations/:id/settle`) — p95 ≤ 50 ms, số câu cố
// định. Nền: 2.000 SP (mỗi SP 1 thành phần, 10 lô + 10 dòng sổ) + 2.000 HĐ × 5 dòng đã giao ở acme + beta; lượt chẵn Mua 5/dòng, lượt lẻ Bán 5/dòng (tồn ổn định).
// Mốc mới (và cặp HĐ mới mỗi 20 lượt) tạo trong `before` (không tính giờ). Chỉ chạy dưới `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inPackAsRollback } from "@ai/test-kit/db";
import { type Cap, type PlanNode, seqScansIn, seqScansOf } from "@ai/test-kit/perf";
import { captureSql, measure } from "../../HD1/_support/hd1";
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
    select p.tenant_id, p.id, 0, p.name, 'stock', 50, 500000, 10000
    from contracts.products p where p.tenant_id = ${tenant}::uuid`;
  // Lô nhỏ (5) như nhập thật: bán FIFO rút hết lô cũ ⇒ số lô còn hàng mỗi thành phần ổn định (~10) qua các lượt.
  await sql`insert into contracts.stock_lots (id, tenant_id, component_id, qty, remaining, received_on)
    select gen_random_uuid(), x.tenant_id, x.id, 5, 5, date '2026-01-01' + k
    from contracts.product_components x, generate_series(0, 9) k where x.tenant_id = ${tenant}::uuid`;
  await sql`insert into contracts.stock_moves (id, tenant_id, component_id, lot_id, direction, qty, unit_cost, amount,
      on_hand_before, on_hand_after, value_before, value_after, avg_before, avg_after, moved_on)
    select gen_random_uuid(), l.tenant_id, l.component_id, l.id, 'in', l.qty, 10000, 50000, 0, 5, 0, 50000,
      0, 10000, l.received_on
    from contracts.stock_lots l where l.tenant_id = ${tenant}::uuid`;
  // Nền HĐ như tenant thật: 2.000 HĐ × 5 dòng, mỗi dòng đã giao một đợt (thống kê `contract_id` nhiều giá trị khác nhau).
  await sql`insert into contracts.contracts (tenant_id, title, created_by, status, direction, fields)
    select ${tenant}::uuid, 'HĐ nền ' || g, ${P.lan.id}::uuid, 'active', 'purchase', '{}'::jsonb
    from generate_series(1, 2000) g`;
  await sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name, qty, unit_price)
    select k.tenant_id, k.id, g, 'Dòng ' || g, 10, 1000
    from contracts.contracts k, generate_series(1, 5) g where k.tenant_id = ${tenant}::uuid and k.title like 'HĐ nền %'`;
  await sql`insert into contracts.milestone_items (tenant_id, contract_id, milestone_id, contract_item_id, qty, delivered)
    select i.tenant_id, i.contract_id, gen_random_uuid(), i.id, null, 10
    from contracts.contract_items i where i.tenant_id = ${tenant}::uuid`;
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

const RELS = [
  "contract_items",
  "milestone_items",
  "obligations",
  "contracts",
  "product_components",
  "stock_lots",
  "stock_moves",
  "products",
];
/** Câu của một lần xác nhận Bán 20 dòng (HĐ mới). */
async function captureOne(): Promise<Cap[]> {
  const [k, plan] = await contract(true, ps);
  const m = await addDelivery(c, k, plan);
  const cap = await captureSql(c, () =>
    call(c, P.hoa, "POST", `/obligations/${m}/settle`, { at: d(0) }),
  );
  return cap.queries.filter((q) => !/set_config/.test(q.text));
}
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `'${s.replaceAll("'", "''")}'`;
};
/** Seq Scan trên bảng lớn ở kế hoạch RIÊNG (giá trị thật) và kế hoạch CHUNG (câu chuẩn bị sẵn, `force_generic_plan`). */
async function planScans(caps: Cap[]): Promise<string[]> {
  const out: string[] = [];
  for (const [i, q] of caps.entries()) {
    const run = <R>(fn: (tx: Sql) => Promise<R>) =>
      inPackAsRollback("contracts", T.acme, P.hoa.id, fn);
    for (const s of await seqScansOf(run, q, RELS)) out.push(`#${i} riêng: ${s}`);
    const generic = await run(async (tx) => {
      await tx.unsafe("set local plan_cache_mode = force_generic_plan");
      await tx.unsafe(`prepare g${i} as ${q.text}`);
      const rows = (await tx.unsafe(
        `explain (format json) execute g${i}(${q.params.map(lit).join(", ")})`,
      )) as unknown as { "QUERY PLAN": { Plan: PlanNode }[] }[];
      return seqScansIn(rows[0]?.["QUERY PLAN"]?.[0]?.Plan as PlanNode, RELS);
    });
    for (const s of generic) out.push(`#${i} chung: ${s}`);
  }
  return out;
}

describe("V2-D · xác nhận mốc giao 20 dòng (HTTP)", () => {
  for (const analyzed of [false, true]) {
    it(`p95 ≤ 50 ms (${analyzed ? "sau" : "trước"} ANALYZE)`, async () => {
      if (analyzed)
        await c.sql`analyze contracts.product_components, contracts.stock_lots, contracts.stock_moves,
          contracts.products, contracts.contract_items, contracts.milestone_items, contracts.obligations`;
      const seq = await planScans(await captureOne());
      expect({ analyzed, seq }).toEqual({ analyzed, seq: [] });
      // Cặp HĐ Mua/Bán mới mỗi 20 lượt (mỗi HĐ ~10 lần giao, như HĐ thật giao nhiều đợt); HĐ cũ ở lại làm nền.
      let pair: [string, PlanRow[]][] = [];
      let m = "";
      const st = await measure(
        c,
        () => call(c, P.hoa, "POST", `/obligations/${m}/settle`, { at: d(0) }),
        {
          n: 200,
          before: async (i) => {
            if (pair.length === 0 || Math.abs(i) % 20 === 0)
              pair = [await contract(false, ps), await contract(true, ps)];
            const [k, plan] = pair[Math.abs(i) % 2] as [string, PlanRow[]];
            m = await addDelivery(c, k, plan);
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
