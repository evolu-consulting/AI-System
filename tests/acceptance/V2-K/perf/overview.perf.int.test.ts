// V2-K · Luật 4c · ngưỡng intake §3: tổng hợp Tổng quan trên 10.000 mốc p95 ≤ 100 ms (sau ANALYZE), số câu SQL cố định (không theo
// số mốc). Dữ liệu: 2.000 HĐ bán × 4 mốc thu (nửa trống ⇒ chia 5.4a, nửa đã thu) + 1.000 HĐ giới thiệu × 2 mốc hoa hồng = 10.000 mốc
// rải 24 tháng; nửa HĐ bán có dòng gắn SP (giá vốn BQ); cùng cỡ ở beta làm nền. Chỉ chạy dưới `PERF=1`. Báo số thật.
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
import { arrangeV2k, type CtxN1, P, type Sql, startHd1, T } from "../_support/v2k";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

async function seed(sql: Sql, tenant: string, sells: number, refs: number) {
  const [p] = await sql<
    { id: string }[]
  >`insert into contracts.products (tenant_id, name, unit, grp)
    values (${tenant}, ${`SP perf ${tenant.slice(0, 4)}`}, 'cái', 'goods') returning id::text`;
  await sql`insert into contracts.product_components (tenant_id, product_id, ord, name, mode, on_hand, stock_value, avg_cost)
    values (${tenant}, ${p?.id as string}, 0, 'SP perf', 'stock', 1000, 5000000000, 5000000)`;
  await sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, deal, commission_pct, status, owner_user_id,
      created_by, fields)
    select gen_random_uuid(), ${tenant}, 'contract', 'HĐ ' || g, 'sale', case when g <= ${sells} then 'sell' else 'referral' end,
      case when g > ${sells} then 10 end, 'active', ${P.lan.id}, ${P.lan.id},
      jsonb_build_object('number', jsonb_build_object('value', 'P-' || g),
        'total_value', jsonb_build_object('value', 100000000 + g),
        'buyer_name', jsonb_build_object('value', 'Khách ' || g),
        'supplier_name', jsonb_build_object('value', 'Chúng Tôi'))
    from generate_series(1, ${sells + refs}::int) g`;
  await sql`delete from contracts.obligations where tenant_id = ${tenant}`;
  await sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name, qty, unit_price, product_id)
    select c.tenant_id, c.id, 0, 'Dòng', 10, 9000000, ${p?.id as string}::uuid from contracts.contracts c
    where c.tenant_id = ${tenant} and c.deal = 'sell' and c.title ~ '[02468]$'`;
  await sql`insert into contracts.obligations (tenant_id, contract_id, direction, kind, seq, due_date, amount, status, done_at, title)
    select c.tenant_id, c.id, 'receive', case when c.deal = 'sell' then 'payment' else 'commission' end, i,
      current_date - ((i * 97 + length(c.title) * 13) % 720) + 30,
      case when i % 2 = 0 then 20000000 end,
      case when i % 2 = 0 then 'done' else 'open' end,
      case when i % 2 = 0 then current_date - ((i * 97 + length(c.title) * 13) % 720) + 32 end, 'Mốc ' || i
    from contracts.contracts c, generate_series(1, 4) i
    where c.tenant_id = ${tenant} and (c.deal = 'sell' or i <= 2)`;
}

describe("V2-K · Tổng quan 10.000 mốc", () => {
  it("p95 ≤ 100 ms (tháng / quý / 12 tháng), số câu SQL cố định", async () => {
    await arrangeV2k(c);
    await seed(c.sql, T.acme, 5, 2);
    const token = await c.tok(P.lan);
    const path = "/pack/contracts/overview?period=12m";
    for (let i = 0; i < 3; i++) await getWith(c, token, path);
    const small = (await captureSql(c, () => getWith(c, token, path))).queries.length;

    await arrangeV2k(c);
    await seed(c.sql, T.acme, 2_000, 1_000);
    await seed(c.sql, T.beta, 2_000, 1_000);
    await c.sql`analyze contracts.contracts, contracts.obligations, contracts.contract_items, contracts.product_components`;
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.obligations
      where tenant_id = ${T.acme} and kind in ('payment', 'commission')`;
    expect(n?.n).toBe(10_000);
    for (let i = 0; i < 3; i++) await getWith(c, token, path);
    // Câu nền của Hub (nạp lại cấu hình/quyền sau khi dọn) có thể lọt vào một lần chụp ⇒ lấy lần ít câu nhất trong 3 lần.
    let { queries } = await captureSql(c, () => getWith(c, token, path));
    for (let i = 0; i < 2 && queries.length !== small; i++)
      queries = (await captureSql(c, () => getWith(c, token, path))).queries;
    console.log(`V2-K /overview: ${queries.length} câu SQL (nhỏ ${small})`);
    expect(queries.length).toBe(small);
    // Kế hoạch câu gom dưới role gói + RLS thật (JIT tắt như `withPackScope`) — tách thời gian SQL khỏi HTTP/JSON.
    const agg = queries.find((q) => q.text.includes("w as materialized")) as Cap;
    const plan = await inPack(
      T.acme,
      async (tx) => {
        await tx.unsafe("select set_config('jit', 'off', true)");
        await tx.unsafe(`select set_config('app.user_id', '${P.lan.id}', true)`);
        const ms: number[] = [];
        for (let i = 0; i < 30; i++) {
          const t0 = performance.now();
          await tx.unsafe(literalize(agg));
          ms.push(performance.now() - t0);
        }
        ms.sort((a, b) => a - b);
        console.log(
          `V2-K câu gom (12 tháng): p50 ${ms[15]?.toFixed(1)} ms · p95 ${ms[28]?.toFixed(1)} ms`,
        );
        return (await tx.unsafe(
          `explain (analyze, format text) ${literalize(agg)}`,
        )) as unknown as {
          "QUERY PLAN": string;
        }[];
      },
      ROLE_RW,
    );
    if (process.env.V2K_PERF_PLAN) console.log(plan.map((x) => x["QUERY PLAN"]).join("\n"));
    for (const period of ["month", "quarter", "12m"]) {
      const st = await measure(
        c,
        () => getWith(c, token, `/pack/contracts/overview?period=${period}`),
        {
          n: 60,
        },
      );
      console.log(
        `V2-K GET /overview?period=${period}: p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      expect(st.p95).toBeLessThanOrEqual(100);
    }
  }, 300_000);
});
