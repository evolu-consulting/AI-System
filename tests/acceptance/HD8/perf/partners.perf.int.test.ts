// HD8-NFR-01 · Luật 4c: danh sách đối tác / so giá — p95 ≤ 50 ms, số câu SQL cố định (không theo số đối tác/sự kiện).
// Dữ liệu: 400 đối tác (200 khách + 200 NCC), 2.000 HĐ đã duyệt × 3 dòng hàng, 10.000 dòng sổ (acme) + cùng cỡ ở beta làm nền.
// Chỉ chạy dưới `PERF=1` (`bun run test:perf`). Báo số thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { captureSql, getWith, measure } from "../../HD1/_support/hd1";
import { arrangeHd8, BASE, type CtxN1, P, type Sql, startHd1, T } from "../_support/hd8";

const CONTRACTS = 2_000;
const EVENTS = 10_000;
let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** `n` HĐ (nửa bán, nửa mua) của `parties` đối tác mỗi chiều, mỗi HĐ 3 dòng hàng; `events` dòng sổ rải 12 tháng. */
async function seed(sql: Sql, tenant: string, n: number, parties: number, events: number) {
  await sql`insert into contracts.contracts (id, tenant_id, title, direction, status, created_by, fields)
    select gen_random_uuid(), ${tenant}, 'HĐ ' || g, case when g % 2 = 0 then 'sale' else 'purchase' end, 'active',
      ${P.lan.id}, jsonb_build_object('number', jsonb_build_object('value', 'P-' || g),
        'start_date', jsonb_build_object('value', '2025-01-01'),
        'buyer_name', jsonb_build_object('value', 'Khách ' || (g % ${parties})),
        'buyer_tax_id', jsonb_build_object('value', '0310' || lpad((g % ${parties})::text, 6, '0')),
        'supplier_name', jsonb_build_object('value', 'NCC ' || (g % ${parties})),
        'supplier_tax_id', jsonb_build_object('value', '0320' || lpad((g % ${parties})::text, 6, '0')))
    from generate_series(1, ${n}) g`;
  await sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, unit_price)
    select ${tenant}, k.id, i, 'Hàng ' || ((row_number() over ()) % 40), 'kg', 10000 + ((row_number() over ()) % 997)
    from contracts.contracts k cross join generate_series(0, 2) i where k.tenant_id = ${tenant}`;
  await sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at, source, days_late)
    select ${tenant},
      case when g % 2 = 0 then 'tax:0310' else 'tax:0320' end || lpad((g % ${parties})::text, 6, '0'),
      case when g % 2 = 0 then 'customer' else 'supplier' end,
      case when g % 2 = 0 then (case when g % 7 = 0 then 'reminded' else 'received' end) else 'delivered' end,
      current_date - (g % 360), 'action', case when g % 5 = 0 then 3 else 0 end
    from generate_series(1, ${events}) g`;
}

const count = async (path: string) => {
  const token = await c.tok(P.hoa);
  const { queries } = await captureSql(c, () => getWith(c, token, `${BASE}${path}`));
  return queries.length;
};

describe("HD8-NFR-01 · danh sách đối tác + so giá", () => {
  it("số câu SQL không đổi theo cỡ dữ liệu (10 đối tác ⇒ 400 đối tác)", async () => {
    await arrangeHd8(c);
    await seed(c.sql, T.acme, 20, 10, 50);
    const small = [await count("/partners"), await count("/prices/products")];
    await arrangeHd8(c);
    await seed(c.sql, T.acme, CONTRACTS, 200, EVENTS);
    const big = [await count("/partners"), await count("/prices/products")];
    console.log(`HD8 số câu SQL /partners, /prices/products: nhỏ ${small} · lớn ${big}`);
    expect(big).toEqual(small);
    expect(big[0]).toBeLessThanOrEqual(3);
  }, 180_000);

  it("p95 ≤ 50 ms: /partners, /partners?role=supplier, /prices/products, /prices/compare (sau ANALYZE)", async () => {
    await arrangeHd8(c);
    await seed(c.sql, T.acme, CONTRACTS, 200, EVENTS);
    await seed(c.sql, T.beta, CONTRACTS, 200, EVENTS);
    await c.sql`analyze contracts.contracts, contracts.contract_items, contracts.partner_events`;
    const token = await c.tok(P.hoa);
    const paths = [
      "/partners",
      "/partners?role=supplier",
      "/prices/products",
      `/prices/compare?product=${encodeURIComponent("name:hang 1|")}`,
    ];
    for (const path of paths) {
      const st = await measure(c, () => getWith(c, token, `${BASE}${path}`), { n: 60 });
      console.log(
        `HD8 GET ${path}: p50 ${st.p50.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · max ${st.max.toFixed(1)} ms`,
      );
      expect(st.p95).toBeLessThanOrEqual(50);
    }
  }, 300_000);
});
