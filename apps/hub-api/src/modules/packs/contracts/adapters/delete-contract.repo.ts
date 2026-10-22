// V2-M · xoá HĐ: câu SQL văn bản cố định, lọc `tenant_id` tường minh ngoài RLS. Xem trước = MỘT câu (HĐ + phụ lục); xoá =
// `contracts.delete_contract` (SECURITY INVOKER, migration 0035) + `reverseContractStock` (đảo kho). HĐ không thấy (M1) / tenant
// khác ⇒ null (404).
import type { DeleteImpact } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { DeleteContractRepo } from "../application/delete-contract.usecase";
import { one } from "./ledger-sql";
import { contractStockBlock, reverseContractStock } from "./stock.repo";

/** HĐ + phụ lục (đệ quy) thấy được; rỗng nếu HĐ không thấy. */
const familyOf = async (tx: Tx, t: string, id: string): Promise<string[]> => {
  const rows = await tx.execute<{ id: string }>(sql`with recursive fam as (
      select k.id from contracts.contracts k where k.tenant_id = ${t}::uuid and k.id = ${id}::uuid
      union select a.id from contracts.contracts a join fam on a.parent_id = fam.id where a.tenant_id = ${t}::uuid)
    select id::text from fam`);
  const all = [...rows].map((r) => r.id);
  return all.includes(id) ? [id, ...all.filter((x) => x !== id)] : [];
};

/** Tác động (JSON) của việc xoá HĐ `ids[0]` + phụ lục; `ids` = mảng uuid dạng `{a,b}`. */
const previewSql = (t: string, ids: string[]) => {
  const arr = sql`${`{${ids.join(",")}}`}::uuid[]`;
  // products-confirm: SP gắn HĐ (dòng HĐ hoặc sinh từ HĐ) mà không còn HĐ nào khác dùng (dòng HĐ / dòng kho) — người xoá chọn.
  return sql`with orphans as (select p.id, p.name from contracts.products p
        where p.tenant_id = ${t}::uuid
          and (p.created_from_contract_id = any(${arr}) or exists (select 1 from contracts.contract_items i
            where i.tenant_id = p.tenant_id and i.product_id = p.id and i.contract_id = any(${arr})))
          and not exists (select 1 from contracts.contract_items i
            where i.tenant_id = p.tenant_id and i.product_id = p.id and not i.contract_id = any(${arr}))
          and not exists (select 1 from contracts.stock_moves m
            join contracts.product_components pc on pc.tenant_id = m.tenant_id and pc.id = m.component_id
            where pc.tenant_id = p.tenant_id and pc.product_id = p.id and m.contract_id is not null
              and not m.contract_id = any(${arr})))
    select jsonb_build_object(
      'contract', jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title),
      'milestones', (select count(*)::int from contracts.obligations o
        where o.tenant_id = c.tenant_id and o.contract_id = any(${arr})),
      'delivered_lines', (select count(*)::int from contracts.milestone_items mi
        where mi.tenant_id = c.tenant_id and mi.contract_id = any(${arr}) and mi.delivered is not null),
      'stock', coalesce((select jsonb_agg(jsonb_build_object('product', p.name, 'component', pc.name,
          'direction', m.direction, 'qty', m.qty::text) order by m.seq)
        from contracts.stock_moves m
        join contracts.product_components pc on pc.tenant_id = m.tenant_id and pc.id = m.component_id
        join contracts.products p on p.tenant_id = pc.tenant_id and p.id = pc.product_id
        where m.tenant_id = c.tenant_id and m.contract_id = any(${arr}) and m.reason = 'delivery'
          and not exists (select 1 from contracts.stock_moves r where r.tenant_id = m.tenant_id and r.reverses = m.id)),
        '[]'::jsonb),
      'service_customers', (select count(*)::int from contracts.service_customers s
        where s.tenant_id = c.tenant_id and s.contract_id = any(${arr})),
      'products', coalesce((select jsonb_agg(o.name order by o.name) from orphans o), '[]'::jsonb),
      'orphan_products', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
        from orphans o), '[]'::jsonb),
      'partner_events', (select count(*)::int from contracts.partner_events e
        where e.tenant_id = c.tenant_id and e.contract_id = any(${arr})
          and not exists (select 1 from contracts.partner_event_voids v where v.event_id = e.id and v.tenant_id = e.tenant_id)),
      'appendices', ${ids.length - 1}::int,
      'has_cks', exists (select 1 from contracts.cks_lots l where l.tenant_id = c.tenant_id and l.purchase_contract_id = any(${arr}))
        or exists (select 1 from contracts.cks_certificates x where x.tenant_id = c.tenant_id and x.sale_contract_id = any(${arr}))
        or exists (select 1 from contracts.cks_renewals r where r.tenant_id = c.tenant_id
          and (r.sale_contract_id = any(${arr}) or r.new_contract_id = any(${arr})))) as j
    from contracts.contracts c where c.tenant_id = ${t}::uuid and c.id = ${ids[0]}::uuid`;
};

export function deleteContractRepo(tx: Tx, t: string): DeleteContractRepo {
  return {
    preview: async (id, on) => {
      const fam = await familyOf(tx, t, id);
      if (fam.length === 0) return null;
      const out = await one<Omit<DeleteImpact, "stock_blocked">>(tx, previewSql(t, fam));
      return out ? { ...out, stock_blocked: await contractStockBlock(tx, t, fam, on) } : null;
    },
    reverseStock: async (id, on) => reverseContractStock(tx, t, await familyOf(tx, t, id), on),
    // products-confirm (0046): chỉ xoá SP người xoá đã chọn VÀ không còn HĐ khác dùng (hàm kiểm lại trước khi xoá HĐ).
    remove: (id, products) =>
      one(
        tx,
        sql`select contracts.delete_contract(${id}::uuid, ${t}::uuid, ${`{${products.join(",")}}`}::uuid[]) as j`,
      ),
  };
}
