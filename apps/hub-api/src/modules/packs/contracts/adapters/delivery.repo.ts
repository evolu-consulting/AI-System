// V2-D · HD-05 · BA §5.7 · Luật 4c: câu SQL của mốc giao ⇒ kho. Tx do `PackUow` mở (role `contracts_rw`, RLS tenant + M1); lọc
// `tenant_id` tường minh ngoài RLS. `load` = MỘT câu cho cả mốc (dòng HĐ, đã giao, bảng SL, thành phần) — không theo từng dòng.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type {
  DeliveryItemRow,
  DeliveryLoad,
  DeliveryRepo,
  StockRow,
} from "../application/delivery.ports";
import { json, one } from "./ledger-sql";
import { applyDelivery } from "./stock.repo";

const pgArr = (ids: readonly string[]) => `{${ids.join(",")}}`;

/** JSON mảng dòng HĐ của HĐ có id = biểu thức `cid` (+ Σ đã giao theo dòng, một nhóm theo HĐ). */
const itemsJson = (
  t: string,
  cid: SQL,
) => sql`coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name,
      'unit', i.unit, 'qty', i.qty::text, 'unit_price', i.unit_price, 'product_id', i.product_id,
      'component_ids', i.component_ids, 'delivered', coalesce(dv.n, 0)::text) order by i.ord)
    from contracts.contract_items i
    left join (select mi.contract_item_id, sum(mi.delivered) as n from contracts.milestone_items mi
      where mi.tenant_id = ${t}::uuid and mi.contract_id = ${cid} and mi.delivered is not null
      group by mi.contract_item_id) dv on dv.contract_item_id = i.id
    where i.tenant_id = ${t}::uuid and i.contract_id = ${cid}), '[]'::jsonb)`;

// Mỗi bảng có RLS đọc MỘT lần (policy M1 tốn ~0,3 ms mỗi lần đánh giá): dòng HĐ một lần, SL mốc một lần cho cả HĐ (đã giao
// theo dòng + bảng của mốc này cùng lượt quét), thành phần theo SP lấy từ chính `it`. Lọc HĐ bằng `= (select …)` (tham số
// InitPlan) chứ không join CTE ⇒ kế hoạch CHUNG của câu chuẩn bị sẵn vẫn đi index (đo: join ⇒ Seq Scan `milestone_items`).
const loadQ = (t: string, milestoneId: string) => sql`with k as materialized (
            select o.id as mid, o.status, o.kind, o.qty, o.delivery_pct, c.id, c.deal, c.end_date, c.owner_user_id, c.number,
              contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value') as supplier,
              (select coalesce(sum(x.delivery_pct), 0) from contracts.obligations x where x.tenant_id = ${t}::uuid
                and x.contract_id = c.id and x.kind = 'delivery' and x.status = 'done' and x.id <> o.id) as pct_before,
              coalesce((select s.allow_negative_stock from contracts.approval_settings s
                where s.tenant_id = ${t}::uuid), false) as allow_neg
            from contracts.obligations o
            join contracts.contracts c on c.tenant_id = ${t}::uuid and c.id = o.contract_id
            where o.tenant_id = ${t}::uuid and o.id = ${milestoneId}::uuid and o.status <> 'replaced'),
          it as materialized (
            select i.id, i.ord, i.name, i.unit, i.qty, i.unit_price, i.product_id, i.component_ids
            from contracts.contract_items i
            where i.tenant_id = ${t}::uuid and i.contract_id = (select k.id from k)),
          mi as materialized (
            select m.milestone_id, m.contract_item_id, m.qty, m.delivered
            from contracts.milestone_items m
            where m.tenant_id = ${t}::uuid and m.contract_id = (select k.id from k)),
          dv as (select mi.contract_item_id, sum(mi.delivered) as n from mi where mi.delivered is not null
            group by mi.contract_item_id)
          select jsonb_build_object('contract_id', k.id, 'deal', k.deal, 'end_date', k.end_date, 'status', k.status,
            'kind', k.kind, 'qty', k.qty::text, 'supplier', k.supplier, 'owner', k.owner_user_id, 'number', k.number,
            'pct', k.delivery_pct::text, 'pct_before', k.pct_before::text, 'allow_negative', k.allow_neg,
            'items', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'name', it.name, 'unit', it.unit,
                'qty', it.qty::text, 'unit_price', it.unit_price, 'product_id', it.product_id,
                'component_ids', it.component_ids, 'delivered', coalesce(dv.n, 0)::text) order by it.ord)
              from it left join dv on dv.contract_item_id = it.id), '[]'::jsonb),
            'plan', coalesce((select jsonb_agg(jsonb_build_object('item_id', mi.contract_item_id, 'qty', mi.qty::text,
                'delivered', mi.delivered::text)) from mi where mi.milestone_id = k.mid), '[]'::jsonb),
            'comps', coalesce((select jsonb_agg(jsonb_build_object('id', pc.id, 'product_id', pc.product_id, 'name', pc.name,
                'unit', coalesce(pc.unit, p.unit), 'mode', pc.mode, 'ord', pc.ord))
              from contracts.product_components pc
              join contracts.products p on p.tenant_id = pc.tenant_id and p.id = pc.product_id
              where pc.tenant_id = ${t}::uuid
                and pc.product_id = any (array(select it.product_id from it where it.product_id is not null))),
              '[]'::jsonb)) as j
          from k`;

export function deliveryRepo(tx: Tx, t: string): DeliveryRepo {
  return {
    load: (milestoneId) => one<DeliveryLoad | null>(tx, loadQ(t, milestoneId)),
    contractItems: async (contractId) =>
      (await one<DeliveryItemRow[] | null>(
        tx,
        sql`select ${itemsJson(t, sql`${contractId}::uuid`)} as j`,
      )) ?? [],
    replacePlan: async (milestoneId, contractId, rows) => {
      await tx.execute(sql`with x as (
          select * from jsonb_to_recordset(${json(rows)}) as x(item_id uuid, qty text)),
        d as (
          delete from contracts.milestone_items mi
          where mi.tenant_id = ${t}::uuid and mi.milestone_id = ${milestoneId}::uuid and mi.delivered is null
            and mi.contract_item_id <> all (array(select x.item_id from x)))
        insert into contracts.milestone_items (tenant_id, contract_id, milestone_id, contract_item_id, qty)
        select ${t}::uuid, ${contractId}::uuid, ${milestoneId}::uuid, x.item_id, x.qty::numeric from x
        on conflict (tenant_id, milestone_id, contract_item_id) do update set qty = excluded.qty, updated_at = now()`);
    },
    apply: (moves, on) => applyDelivery(tx, moves, { tenantId: t, on }),
    stockOf: async (productIds) =>
      productIds.length === 0
        ? []
        : [
            ...(await tx.execute<StockRow>(sql`select pc.id::text, pc.product_id::text, pc.name, pc.mode,
                pc.on_hand::text
              from contracts.product_components pc
              where pc.tenant_id = ${t}::uuid and pc.product_id = any (${pgArr(productIds)}::uuid[])
              order by pc.product_id, pc.ord`)),
          ],
  };
}
