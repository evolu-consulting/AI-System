// V2-B · Luật 4c · intake §3 (ngưỡng V2-D): xác nhận một mốc giao 20 dòng qua `applyDelivery` — p95 ≤ 50 ms, số câu SQL cố định
// (1 câu phạm vi `withPackScope` + 4 câu nghiệp vụ, không phụ thuộc số dòng), không Seq Scan trên bảng kho. Dữ liệu: tenant A 100 SP ×
// 20 thành phần, mỗi thành phần 20 lô (40.000 lô + 40.000 dòng sổ) + nền tenant B như vậy; người dùng ở chế độ thấy `org` (policy M1
// chạy thật). Đo trước/sau ANALYZE. Chỉ chạy dưới `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db";
import { inPackAs } from "@ai/test-kit/db";
import { captureSql, measure, seqScansOf } from "@ai/test-kit/perf";
import { applyDelivery, type DeliveryMove, type Sql, type World, world } from "../_support/v2b";

const LINES = 20;
const RELS = ["product_components", "stock_lots", "stock_moves", "products"];
let w: World;
let compsA: string[] = [];

async function seed(sql: Sql, tenant: string, contract: string, by: string): Promise<string[]> {
  await sql`insert into contracts.products (tenant_id, name, unit, grp)
    select ${tenant}::uuid, 'SP perf ' || g, 'cái', 'goods' from generate_series(1, 100) g`;
  await sql`insert into contracts.product_components (tenant_id, product_id, ord, name, mode, on_hand, stock_value, avg_cost)
    select p.tenant_id, p.id, k, p.name || ' #' || k, 'stock', 100000, 1000000000, 10000
    from contracts.products p, generate_series(0, 19) k where p.tenant_id = ${tenant}::uuid`;
  await sql`insert into contracts.stock_lots (id, tenant_id, component_id, qty, remaining, received_on)
    select gen_random_uuid(), c.tenant_id, c.id, 100000, case when k = 19 then 100000 else 0 end, date '2026-01-01' + k
    from contracts.product_components c, generate_series(0, 19) k where c.tenant_id = ${tenant}::uuid`;
  await sql`insert into contracts.stock_moves (id, tenant_id, component_id, lot_id, direction, qty, unit_cost, amount,
      on_hand_before, on_hand_after, value_before, value_after, avg_before, avg_after, moved_on, contract_id, created_by)
    select gen_random_uuid(), l.tenant_id, l.component_id, l.id, 'in', l.qty, 10000, 1000000000, 0, 100000, 0, 1000000000,
      0, 10000, l.received_on, ${contract}::uuid, ${by}::uuid
    from contracts.stock_lots l where l.tenant_id = ${tenant}::uuid`;
  return (
    await sql<{ id: string }[]>`select id::text from contracts.product_components
      where tenant_id = ${tenant}::uuid order by id`
  ).map((r) => r.id);
}

/** Lượt i: 20 thành phần liên tiếp; lượt chẵn bán 5, lượt lẻ nhập 5 (tồn ổn định). */
const movesOf = (i: number): DeliveryMove[] => {
  const k = Math.abs(i) % 50;
  const sell = Math.abs(i) % 2 === 0;
  return compsA.slice(k * LINES, k * LINES + LINES).map((componentId) =>
    sell
      ? { componentId, direction: "out", qty: "5", contractId: w.C1 }
      : {
          componentId,
          direction: "in",
          qty: "5",
          unitPrice: 11_000,
          contractId: w.C1,
          supplierPartyKey: "tax:0311111111",
        },
  );
};
const confirm = (i: number) =>
  withPackScope(w.db, { packKey: "contracts", tenantId: w.A, userId: w.u1 }, (tx) =>
    applyDelivery(tx, movesOf(i), { tenantId: w.A, on: "2026-11-01" }),
  );
const client = (): Sql => (w.db.db as unknown as { $client: Sql }).$client;

beforeAll(async () => {
  w = await world({ ns: 2321 });
  compsA = await seed(w.sql, w.A, w.C1, w.u1);
  await seed(w.sql, w.B, w.CB, w.b1);
}, 180_000);
afterAll(async () => {
  await w?.stop();
});

describe("V2-B · xác nhận mốc giao 20 dòng (applyDelivery)", () => {
  for (const analyzed of [false, true]) {
    it(`p95 ≤ 50 ms, 1 + 4 câu SQL, không Seq Scan (${analyzed ? "sau" : "trước"} ANALYZE)`, async () => {
      if (analyzed)
        await w.sql`analyze contracts.product_components, contracts.stock_lots, contracts.stock_moves, contracts.products`;
      const cap = await captureSql(client(), () => confirm(analyzed ? 1000 : 2000));
      expect(cap.r.components).toHaveLength(LINES);
      expect(cap.queries.length).toBe(5);
      const st = await measure(confirm, { n: 200, warm: 10 });
      console.log(
        `V2-B applyDelivery 20 dòng (${analyzed ? "sau" : "trước"} ANALYZE): p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      const run = <R>(fn: (tx: Sql) => Promise<R>) =>
        inPackAs("contracts", w.A, w.u1, fn, { rollback: true });
      for (const q of [cap.queries[1], cap.queries[2], cap.queries[4]])
        expect(await seqScansOf(run, q as { text: string; params: unknown[] }, RELS)).toEqual([]);
      expect(st.p95).toBeLessThanOrEqual(50);
    }, 180_000);
  }
});
