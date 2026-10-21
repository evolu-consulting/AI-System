// gap-d1 #19 · câu SQL "Cách lấy hàng" của SP. Tx do `PackUow` mở (RLS tenant + M1); lọc `tenant_id` tường minh. Mỗi lệnh = MỘT câu văn
// bản cố định (JSON dựng trong SQL) — số câu không phụ thuộc số NCC (Luật 4c). Tỉ trọng mua đọc từ sổ kho của THÀNH PHẦN CHÍNH.
import type { ProductSourceCreate, ProductSourceOut } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SourcesRepo } from "../application/product-sources.usecase";
import { one } from "./ledger-sql";

const itemJson =
  sql.raw(`jsonb_build_object('id', s.id, 'supplier_name', s.supplier_name, 'party_key', s.supplier_party_key,
  'lead_days', s.lead_days, 'moq', trim_scale(s.moq)::text, 'price_ref', s.price_ref, 'note', s.note,
  'created_at', to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`);

export function sourcesRepo(tx: Tx, t: string): SourcesRepo {
  const list: SourcesRepo["list"] = (productId) =>
    one(
      tx,
      sql`select jsonb_build_object('group', p.grp,
          'items', coalesce((select jsonb_agg(${itemJson} order by s.created_at, s.id)
            from contracts.product_sources s where s.tenant_id = p.tenant_id and s.product_id = p.id), '[]'::jsonb),
          'purchases', coalesce((select jsonb_agg(x.j order by x.amount desc) from (
              select sum(m.amount) as amount, jsonb_build_object('party_key', m.supplier_party_key,
                'name', max(nullif(k.fields -> 'supplier_name' ->> 'value', '')), 'amount', sum(m.amount)::bigint) as j
              from contracts.stock_moves m
                left join contracts.contracts k on k.id = m.contract_id and k.tenant_id = m.tenant_id
              where m.tenant_id = p.tenant_id and m.direction = 'in' and m.reason in ('delivery', 'manual')
                and m.supplier_party_key is not null
                and m.component_id = (select c2.id from contracts.product_components c2 where c2.tenant_id = p.tenant_id
                  and c2.product_id = p.id and c2.mode <> 'none' order by c2.ord limit 1)
              group by m.supplier_party_key limit 50) x), '[]'::jsonb)) as j
        from contracts.products p where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid`,
    );

  /** Không có SP / SP Giới thiệu ⇒ null; trùng NCC ⇒ Postgres 23505. */
  const add: SourcesRepo["add"] = (productId, b: ProductSourceCreate) =>
    one<ProductSourceOut | null>(
      tx,
      sql`insert into contracts.product_sources as s (tenant_id, product_id, supplier_name, supplier_party_key, lead_days, moq,
          price_ref, note)
        select p.tenant_id, p.id, ${b.supplier_name}, contracts.party_key(${b.supplier_name}::text, ${b.supplier_tax_id ?? null}::text),
          ${b.lead_days ?? null}::int, ${b.moq ?? null}::numeric, ${b.price_ref ?? null}::bigint, ${b.note ?? null}
        from contracts.products p
        where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid and p.grp <> 'referral'
        returning ${itemJson} as j`,
    );

  const remove: SourcesRepo["remove"] = async (productId, sourceId) =>
    (
      await tx.execute(sql`delete from contracts.product_sources
        where tenant_id = ${t}::uuid and product_id = ${productId}::uuid and id = ${sourceId}::uuid returning id`)
    ).length > 0;

  return { list, add, remove };
}
