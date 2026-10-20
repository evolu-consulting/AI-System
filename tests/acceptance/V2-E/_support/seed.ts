// V2-E · Luật 4c: dữ liệu khối cho đo số câu SQL / p95 của bảng điểm v2 — `n` đối tác, mỗi đối tác đủ 3 vai (HĐ mua dịch vụ hoặc hàng
// hoá xen kẽ, HĐ bán hàng hoá, HĐ giới thiệu), mỗi HĐ `k` mốc đã xác nhận rải 0–20 tháng (1/5 trễ lỗi đối tác), mỗi đối tác 2 việc
// ghi tay + 1 lượt chấm sao. Chèn theo tập (generate_series), owner (bỏ RLS). Không chứa `it(...)`.
import type { Sql } from "./v2e";
import { P } from "./v2e";

export async function seedBoard(sql: Sql, tenant: string, n: number, k: number): Promise<void> {
  await sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, deal, product_group, status, owner_user_id,
      created_by, fields)
    select gen_random_uuid(), ${tenant}, 'contract', 'HĐ ' || g || '-' || r, case when r = 0 then 'purchase' else 'sale' end,
      (array['buy', 'sell', 'referral'])[r + 1], case when r = 0 and g % 2 = 0 then 'service' else 'goods' end, 'active',
      ${P.lan.id}, ${P.lan.id},
      jsonb_build_object('number', jsonb_build_object('value', 'B-' || g || '-' || r),
        'start_date', jsonb_build_object('value', (current_date - 40)::text),
        'total_value', jsonb_build_object('value', 1000000 * (1 + g % 7)),
        'buyer_name', jsonb_build_object('value', case when r = 0 then 'Chúng Tôi' else 'Đối tác ' || g end),
        'buyer_tax_id', jsonb_build_object('value', case when r = 0 then '0100000000' else '05' || lpad(g::text, 8, '0') end),
        'supplier_name', jsonb_build_object('value', case when r = 0 then 'Đối tác ' || g else 'Chúng Tôi' end),
        'supplier_tax_id', jsonb_build_object('value', case when r = 0 then '05' || lpad(g::text, 8, '0') else '0100000000' end))
    from generate_series(1, ${n}::int) g, generate_series(0, 2) r`;
  await sql`insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, status, done_at,
      owner, fault, title)
    select c.tenant_id, c.id, 'tax:' || (case when c.deal = 'buy' then c.fields -> 'supplier_tax_id' else c.fields -> 'buyer_tax_id' end ->> 'value'),
      case when c.deal = 'buy' then 'pay' else 'receive' end,
      case c.deal when 'buy' then (case when i % 3 = 0 then 'serial' else 'delivery' end) when 'sell' then 'payment' else 'commission' end,
      i, current_date - (i * 37 % 600) - (case when i % 5 = 0 then 4 else 0 end), 'done', current_date - (i * 37 % 600), 'partner',
      case when i % 5 = 0 then 'partner' end, 'Mốc ' || i
    from contracts.contracts c, generate_series(1, ${k}::int) i where c.tenant_id = ${tenant} and c.deal is not null`;
  await sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at, source, grp, job_type)
    select ${tenant}, 'tax:05' || lpad(g::text, 8, '0'), 'customer', 'job', current_date - (g % 300), 'action', 'goods',
      case when j = 0 then 'complaint' else 'reminded' end
    from generate_series(1, ${n}::int) g, generate_series(0, 1) j`;
  await sql`insert into contracts.score_ratings (tenant_id, party_key, role, grp, criterion, stars, by_user)
    select ${tenant}, 'tax:05' || lpad(g::text, 8, '0'), 'customer', 'goods', 'on_time_payment', 1 + g % 5, ${P.hoa.id}
    from generate_series(1, ${n}::int) g`;
}
