// V2-M · xoá HĐ: câu SQL văn bản cố định, lọc `tenant_id` tường minh ngoài RLS. Xem trước = MỘT câu; xoá = `contracts.delete_contract`
// (SECURITY INVOKER, migration 0035) + `reverseContractStock` (đảo kho). HĐ không thấy (M1) / tenant khác ⇒ null (404).
import type { DeleteImpact } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { DeleteContractRepo } from "../application/delete-contract.usecase";
import { DeleteContractFail } from "../application/delete-contract.usecase";
import { one } from "./ledger-sql";
import { reverseContractStock } from "./stock.repo";

const pg = (e: unknown): { code?: string; detail?: string } =>
  ((e as { cause?: object }).cause ?? e) as { code?: string; detail?: string };

const previewSql = (t: string, id: string) =>
  sql`select jsonb_build_object(
            'contract', jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title),
            'milestones', (select count(*)::int from contracts.obligations o where o.tenant_id = c.tenant_id and o.contract_id = c.id),
            'delivered_lines', (select count(*)::int from contracts.milestone_items mi
              where mi.tenant_id = c.tenant_id and mi.contract_id = c.id and mi.delivered is not null),
            'stock', coalesce((select jsonb_agg(jsonb_build_object('product', p.name, 'component', pc.name,
                'direction', m.direction, 'qty', m.qty::text) order by m.seq)
              from contracts.stock_moves m
              join contracts.product_components pc on pc.tenant_id = m.tenant_id and pc.id = m.component_id
              join contracts.products p on p.tenant_id = pc.tenant_id and p.id = pc.product_id
              where m.tenant_id = c.tenant_id and m.contract_id = c.id and m.reason = 'delivery'
                and not exists (select 1 from contracts.stock_moves r where r.tenant_id = m.tenant_id and r.reverses = m.id)),
              '[]'::jsonb),
            'service_customers', (select count(*)::int from contracts.service_customers s
              where s.tenant_id = c.tenant_id and s.contract_id = c.id),
            'products', coalesce((select jsonb_agg(p.name order by p.name) from contracts.products p
              where p.tenant_id = c.tenant_id and p.created_from_contract_id = c.id
                and not exists (select 1 from contracts.contract_items i
                  where i.tenant_id = c.tenant_id and i.product_id = p.id and i.contract_id <> c.id)
                and not exists (select 1 from contracts.stock_moves m
                  join contracts.product_components pc on pc.tenant_id = m.tenant_id and pc.id = m.component_id
                  where pc.tenant_id = c.tenant_id and pc.product_id = p.id and m.contract_id is not null
                    and m.contract_id <> c.id)), '[]'::jsonb),
            'partner_events', (select count(*)::int from contracts.partner_events e
              where e.tenant_id = c.tenant_id and e.contract_id = c.id
                and not exists (select 1 from contracts.partner_event_voids v where v.event_id = e.id and v.tenant_id = e.tenant_id)),
            'appendices', (select count(*)::int from contracts.contracts a where a.tenant_id = c.tenant_id and a.parent_id = c.id),
            'has_cks', exists (select 1 from contracts.cks_lots l where l.tenant_id = c.tenant_id and l.purchase_contract_id = c.id)
              or exists (select 1 from contracts.cks_certificates x where x.tenant_id = c.tenant_id and x.sale_contract_id = c.id)
              or exists (select 1 from contracts.cks_renewals r where r.tenant_id = c.tenant_id
                and (r.sale_contract_id = c.id or r.new_contract_id = c.id))) as j
          from contracts.contracts c where c.tenant_id = ${t}::uuid and c.id = ${id}::uuid`;

export function deleteContractRepo(tx: Tx, t: string): DeleteContractRepo {
  return {
    preview: (id) => one<DeleteImpact>(tx, previewSql(t, id)),
    reverseStock: (id, on) => reverseContractStock(tx, t, id, on),
    remove: async (id) => {
      try {
        return await one(tx, sql`select contracts.delete_contract(${id}::uuid, ${t}::uuid) as j`);
      } catch (e) {
        const p = pg(e);
        if (p.code === "23503" && p.detail === "appendix")
          throw new DeleteContractFail("has_appendix");
        if (p.code === "23503" && p.detail === "cks") throw new DeleteContractFail("has_cks");
        throw e;
      }
    },
  };
}
