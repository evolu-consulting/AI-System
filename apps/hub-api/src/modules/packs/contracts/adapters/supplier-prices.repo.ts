// V2-J2 · câu SQL tab "Nhà cung cấp & giá". Tx do `PackUow` mở (RLS tenant + M1); lọc `tenant_id` tường minh. Mỗi lệnh = MỘT câu
// văn bản cố định (JSON dựng trong SQL, dữ liệu qua tham số) — số câu không phụ thuộc số NCC/dòng giá (Luật 4c). Giá nhập đọc từ sổ
// kho (`stock_moves`, luật thấy HĐ của M1) cho THÀNH PHẦN CHÍNH của SP (thành phần đầu có cách lấy hàng ≠ `none`).
import type { SupplierPriceInput } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SuppliersRepo } from "../application/supplier-prices.usecase";
import type { OverviewData } from "../domain/supplier-advice.rules";
import { CONFIRMED_STATUSES, json, one } from "./ledger-sql";

const CONFIRMED = sql.raw(CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", "));

/** Thành phần chính của SP (bí danh `p`): ord nhỏ nhất có mode ≠ none. */
const MAIN =
  sql.raw(`(select c2.id from contracts.product_components c2 where c2.tenant_id = p.tenant_id
  and c2.product_id = p.id and c2.mode <> 'none' order by c2.ord limit 1)`);

/** Tổng quan NCC của SP: SP + thành phần + giá nhập từ sổ kho + giá đã lưu. */
const overviewQ = (t: string, productId: string) => sql`select jsonb_build_object(
          'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'group', p.grp),
          'components', coalesce((select jsonb_agg(jsonb_build_object('mode', c.mode, 'avg_cost', c.avg_cost) order by c.ord)
            from contracts.product_components c where c.tenant_id = p.tenant_id and c.product_id = p.id), '[]'::jsonb),
          'purchases', coalesce((select jsonb_agg(x.j order by x.amount desc) from (
              select sum(m.amount) as amount, jsonb_build_object('party_key', m.supplier_party_key,
                'name', max(nullif(k.fields -> 'supplier_name' ->> 'value', '')),
                'qty', trim_scale(sum(m.qty))::text, 'times', count(*)::int, 'amount', sum(m.amount)::bigint,
                'last_on', max(m.moved_on),
                'last_price', (array_agg(m.unit_cost order by m.moved_on desc, m.seq desc))[1],
                'best_price', min(m.unit_cost)) as j
              from contracts.stock_moves m
                left join contracts.contracts k on k.id = m.contract_id and k.tenant_id = m.tenant_id
              where m.tenant_id = p.tenant_id and m.component_id = ${MAIN} and m.direction = 'in' and m.reason in ('delivery', 'manual')
                and m.supplier_party_key is not null
              group by m.supplier_party_key limit 50) x), '[]'::jsonb),
          'contract_lines', coalesce((select jsonb_agg(jsonb_build_object('deal', k.deal, 'contract_id', k.id,
              'number', coalesce(k.number, k.title), 'status', k.status, 'price', i.unit_price::float8, 'unit', i.unit,
              'on', k.dt, 'party_name', case when k.deal = 'buy' then k.seller else k.buyer end,
              'party_key', case when k.deal = 'buy'
                then contracts.party_key(k.fields -> 'supplier_name' ->> 'value', k.fields -> 'supplier_tax_id' ->> 'value') end)
              order by k.dt desc nulls last, k.id)
            from (select i0.* from contracts.contract_items i0 where i0.tenant_id = p.tenant_id and i0.product_id = p.id
                and i0.unit_price is not null limit 300) i
              join (select c.id, c.deal, c.number, c.title, c.status, c.seller, c.buyer, c.fields,
                  coalesce(c.start_date, c.created_at::date) as dt
                from contracts.contracts c where c.tenant_id = p.tenant_id and c.kind = 'contract'
                  and c.deal in ('buy', 'sell') and c.status in (${CONFIRMED}) and c.superseded_at is null) k
                on k.id = i.contract_id), '[]'::jsonb),
          'saved', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'supplier_name', s.supplier_name,
              'party_key', s.supplier_party_key, 'kind', s.kind, 'price', s.price, 'unit', s.unit, 'source', s.source,
              'url', s.url, 'seen_on', s.seen_on, 'vat_included', s.vat_included, 'expires_on', s.expires_on,
              'replaced_at', s.replaced_at, 'removed_at', s.removed_at) order by s.seen_on desc, s.created_at desc)
            from (select * from contracts.product_supplier_prices s0 where s0.tenant_id = p.tenant_id
              and s0.product_id = p.id
              -- review Thấp-8: trần 200 tính dòng CÒN hiệu lực trước (lịch sử thay/gỡ không đẩy giá đang dùng ra ngoài)
              order by (s0.removed_at is null and s0.replaced_at is null) desc, s0.seen_on desc, s0.created_at desc
              limit 200) s), '[]'::jsonb)) as j
        from contracts.products p where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid`;

export function suppliersRepo(tx: Tx, t: string): SuppliersRepo {
  const overview: SuppliersRepo["overview"] = (productId) =>
    one<OverviewData | null>(tx, overviewQ(t, productId));

  const head: SuppliersRepo["head"] = (productId) =>
    one<{ name: string; group: "service" | "goods" | "referral" } | null>(
      tx,
      sql`select jsonb_build_object('name', p.name, 'group', p.grp) as j from contracts.products p
        where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid`,
    );

  /** Một CTE: kiểm SP thuộc tenant + chèn cả lô. Không có SP ⇒ 0 dòng (null). */
  const save: SuppliersRepo["save"] = (productId, items: SupplierPriceInput[], today) =>
    one<{ ids: string[] } | null>(
      tx,
      sql`with p as (select id, tenant_id from contracts.products where tenant_id = ${t}::uuid and id = ${productId}::uuid),
      ins as (
        insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, supplier_party_key, kind, price,
          unit, source, url, seen_on, note)
        select p.tenant_id, p.id, x.supplier_name, contracts.party_key(x.supplier_name, x.supplier_tax_id), x.kind, x.price,
          x.unit, x.source, x.url, coalesce(x.seen_on, ${today}::date), x.note
        from p cross join jsonb_to_recordset(${json(items)}) as x(supplier_name text, supplier_tax_id text, kind text,
          price bigint, unit text, source text, url text, seen_on date, note text)
        returning id)
      select jsonb_build_object('ids', coalesce(jsonb_agg(ins.id), '[]'::jsonb)) as j from p left join ins on true
      having count(p.id) > 0`,
    );

  /** com-c7 · R21: gỡ MỀM (`removed_at`, còn trong lịch sử). Ai gỡ được giữ như DELETE 0031: người tạo hoặc người thấy hết. */
  const remove: SuppliersRepo["remove"] = async (productId, priceId) =>
    (
      await tx.execute(sql`update contracts.product_supplier_prices set removed_at = now()
        where tenant_id = ${t}::uuid and product_id = ${productId}::uuid and id = ${priceId}::uuid and removed_at is null
          and ((select contracts.sees_all()) or created_by = nullif(current_setting('app.user_id', true), '')::uuid)
        returning id`)
    ).length > 0;

  return { overview, head, save, remove };
}
