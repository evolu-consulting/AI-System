// V2-B Â· Luáº­t 4c Â· intake Â§3 (ngÆ°á»¡ng V2-D): xÃ¡c nháº­n má»™t má»‘c giao 20 dÃ²ng qua `applyDelivery` â€” p95 â‰¤ 50 ms, sá»‘ cÃ¢u SQL cá»‘ Ä‘á»‹nh
// (1 cÃ¢u pháº¡m vi `withPackScope` + 4 cÃ¢u nghiá»‡p vá»¥, khÃ´ng phá»¥ thuá»™c sá»‘ dÃ²ng), khÃ´ng Seq Scan trÃªn báº£ng kho. Dá»¯ liá»‡u: tenant A 100 SP Ã—
// 20 thÃ nh pháº§n, má»—i thÃ nh pháº§n 20 lÃ´ (40.000 lÃ´ + 40.000 dÃ²ng sá»•) + ná»n tenant B nhÆ° váº­y; ngÆ°á»i dÃ¹ng á»Ÿ cháº¿ Ä‘á»™ tháº¥y `org` (policy M1
// cháº¡y tháº­t). Äo trÆ°á»›c/sau ANALYZE. Chá»‰ cháº¡y dÆ°á»›i `PERF=1` (`bun run test:perf`). BÃ¡o sá»‘ tháº­t.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { inPackAs } from "@ai/test-kit/db";
import { captureSql, measure, seqScansOf } from "@ai/test-kit/perf";
import { applyDelivery, type DeliveryMove, type Sql, type World, world } from "../_support/v2b";

const LINES = 20;
const RELS = ["product_components", "stock_lots", "stock_moves", "products"];
let w: World;
let compsA: string[] = [];

async function seed(sql: Sql, tenant: string, contract: string, by: string): Promise<string[]> {
  await sql`insert into contracts.products (tenant_id, name, unit, grp)
    select ${tenant}::uuid, 'SP perf ' || g, 'cÃ¡i', 'goods' from generate_series(1, 100) g`;
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

/** LÆ°á»£t i: 20 thÃ nh pháº§n liÃªn tiáº¿p; lÆ°á»£t cháºµn bÃ¡n 5, lÆ°á»£t láº» nháº­p 5 (tá»“n á»•n Ä‘á»‹nh). */
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

describe("V2-B Â· xÃ¡c nháº­n má»‘c giao 20 dÃ²ng (applyDelivery)", () => {
  for (const analyzed of [false, true]) {
    it(`p95 â‰¤ 50 ms, 1 + 4 cÃ¢u SQL, khÃ´ng Seq Scan (${analyzed ? "sau" : "trÆ°á»›c"} ANALYZE)`, async () => {
      if (analyzed)
        await w.sql`analyze contracts.product_components, contracts.stock_lots, contracts.stock_moves, contracts.products`;
      await confirm(analyzed ? 1001 : 2001); // kết nối nóng (câu dò kiểu của postgres.js lần đầu không tính)
      const cap = await captureSql(client(), () => confirm(analyzed ? 1000 : 2000));
      expect(cap.r.components).toHaveLength(LINES);
      expect(cap.queries.map((q) => q.text.replace(/\s+/g, " ").slice(0, 60))).toHaveLength(5);
      const st = await measure(confirm, { n: 200, warm: 10 });
      console.log(
        `V2-B applyDelivery 20 dÃ²ng (${analyzed ? "sau" : "trÆ°á»›c"} ANALYZE): p50 ${st.p50.toFixed(1)} ms Â· p95 ${st.p95.toFixed(1)} ms Â· max ${st.max.toFixed(1)} ms`,
      );
      const run = <R>(fn: (tx: Sql) => Promise<R>) =>
        inPackAs("contracts", w.A, w.u1, fn, { rollback: true });
      for (const i of [1, 2, 4]) {
        const seq = await seqScansOf(
          run,
          cap.queries[i] as { text: string; params: unknown[] },
          RELS,
        );
        expect({ i, seq }).toEqual({ i, seq: [] });
      }
      expect(st.p95).toBeLessThanOrEqual(50);
    }, 180_000);
  }
});
