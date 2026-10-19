// HD9-AC09 · dữ liệu đo (Luật 4c): tenant acme 20 lô · 400 khách · 2.000 chữ ký (5/khách, 1 HĐ bán/khách) · 2.000 văn bản ·
// 200 giá thị trường; tenant beta cùng cỡ làm nền. Seed THEO TẬP bằng owner (bỏ RLS), vài câu cố định.
import type { Sql } from "./hd9";

export async function seedCksPerf(sql: Sql, tenant: string, by: string): Promise<void> {
  await sql`insert into contracts.cks_lots (id, tenant_id, label, ca, qty, unit_cost, years, device, bought_at,
      purchase_contract_id, created_by)
    select gen_random_uuid(), ${tenant}, 'L' || g, 'CA ' || (g % 5), 1000, 1000000 + g * 1000, 1 + g % 2,
      case when g % 3 = 0 then 'remote' else 'token' end, date '2026-01-01' + g, gen_random_uuid(), ${by}
    from generate_series(1, 20) g`;
  await sql`insert into contracts.cks_customers (id, tenant_id, name, tax_id)
    select gen_random_uuid(), ${tenant}, 'Khách ' || g, lpad(g::text, 10, '0') from generate_series(1, 400) g`;
  await sql`insert into contracts.contracts (id, tenant_id, title, direction, status, created_by, fields)
    select gen_random_uuid(), ${tenant}, 'Dịch vụ chữ ký số · CKS-2026-' || lpad(n::text, 3, '0'), 'sale', 'active', ${by},
      jsonb_build_object('number', jsonb_build_object('value', 'CKS-2026-' || lpad(n::text, 3, '0')),
        'signed_date', jsonb_build_object('value', '2026-03-01'))
    from generate_series(1, 400) n`;
  await sql`with cu as (select id, row_number() over (order by name) as n from contracts.cks_customers where tenant_id = ${tenant}),
      k as (select id, row_number() over (order by number) as n from contracts.contracts
            where tenant_id = ${tenant} and number like 'CKS-%'),
      lo as (select id, ca, row_number() over (order by label) as n from contracts.cks_lots where tenant_id = ${tenant})
    insert into contracts.cks_certificates (tenant_id, customer_id, serial, serial_key, ca, device, holder_name,
      valid_from, valid_to, source, lot_id, sale_contract_id, sale_price, status)
    select ${tenant}, cu.id, to_hex(cu.n * 10 + s), upper(to_hex(cu.n * 10 + s)), lo.ca, 'token', 'Người ' || s,
      date '2026-03-01', date '2026-03-01' + (cu.n % 700)::int, 'ours', lo.id, k.id, 1500000, 'active'
    from cu join k on k.n = cu.n cross join generate_series(1, 5) s join lo on lo.n = 1 + (cu.n % 20)`;
  await sql`insert into contracts.cks_signed_docs (tenant_id, customer_id, certificate_id, serial_key, kind, title,
      signed_at, source, filename, sha256, created_by)
    select ${tenant}, c.customer_id, c.id, c.serial_key, 'invoice', 'Hóa đơn', date '2026-04-01', 'xml', 'a.xml',
      encode(sha256(c.id::text::bytea), 'hex'), ${by}
    from contracts.cks_certificates c where c.tenant_id = ${tenant}`;
  await sql`insert into contracts.cks_market_prices (tenant_id, ca_key, years, kind, device, seller, price_ex_vat,
      verified, seen)
    select ${tenant}, 'ca' || (g % 5), 1 + g % 2, 'new', 'token', 'S' || g, 1200000 + g * 100, true, date '2026-10-01'
    from generate_series(1, 200) g`;
}
