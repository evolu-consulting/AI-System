// com-c7 · CR-102b · R22/R24: câu SQL "Lưu báo giá". Tx do `PackUow` mở (RLS tenant + GUC người gọi); lọc `tenant_id` tường minh.
// Lưu = 2 câu cố định (khoá tư vấn theo SP+NCC+loại; một CTE thay + chèn + vai NCC), dữ liệu qua tham số (Luật 4c).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SupplierQuoteRepo } from "../application/supplier-quote.ports";
import { json, one } from "./ledger-sql";

export function supplierQuoteRepo(tx: Tx, t: string): SupplierQuoteRepo {
  const quoteBase: SupplierQuoteRepo["quoteBase"] = (productId) =>
    one(
      tx,
      sql`select jsonb_build_object('product', jsonb_build_object('unit', p.unit, 'group', p.grp),
          'rows', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'supplier_name', s.supplier_name,
              'party_key', s.supplier_party_key, 'kind', s.kind, 'price', s.price, 'unit', s.unit, 'source', s.source,
              'vat_included', s.vat_included, 'expires_on', s.expires_on, 'replaced_at', s.replaced_at,
              'removed_at', s.removed_at))
            from (select * from contracts.product_supplier_prices s0 where s0.tenant_id = p.tenant_id and s0.product_id = p.id
              and s0.replaced_at is null and s0.removed_at is null order by s0.seen_on desc, s0.created_at desc limit 300) s),
            '[]'::jsonb)) as j
        from contracts.products p where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid`,
    );

  const lockQuote: SupplierQuoteRepo["lockQuote"] = async (productId, partyKey, kind) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`psp|${t}|${productId}|${partyKey}|${kind}`}, 0))`,
    );
  };

  /** Snapshot chung của câu ⇒ `upd` không thấy dòng `ins` vừa chèn (không tự thay mình). Không SP ⇒ 0 dòng (null). */
  const saveQuote: SupplierQuoteRepo["saveQuote"] = (productId, q) =>
    one(
      tx,
      sql`with p as (select id, tenant_id from contracts.products where tenant_id = ${t}::uuid and id = ${productId}::uuid
          and grp <> 'referral'),
        upd as (update contracts.product_supplier_prices s set replaced_at = now()
          from p where s.tenant_id = p.tenant_id and s.product_id = p.id and s.source = 'quote'
            and s.supplier_party_key = ${q.party_key} and s.kind = ${q.kind}
            and s.replaced_at is null and s.removed_at is null
          returning s.id),
        ins as (insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, supplier_party_key, kind,
            price, unit, source, url, seen_on, vat_included, expires_on, origin_ref)
          select p.tenant_id, p.id, ${q.supplier.name.trim()}, ${q.party_key}, ${q.kind}, ${q.price}::bigint,
            ${q.unit?.trim() || null}, 'quote', ${q.url ?? null}, ${q.quoted_at}::date, ${q.vat_included}::boolean,
            ${q.expires_on ?? null}::date, ${json(q.origin_ref)}
          from p returning id),
        role as (insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from)
          select p.tenant_id, ${q.party_key}, 'supplier', left(${q.supplier.name.trim()}, 300), 'manual' from p
          on conflict (tenant_id, party_key, role) do nothing returning 1)
      select jsonb_build_object('id', (select id from ins),
          'replaced', coalesce((select jsonb_agg(id) from upd), '[]'::jsonb),
          'supplier_created', exists (select 1 from role)) as j
      from p`,
    );

  return { quoteBase, lockQuote, saveQuote };
}
