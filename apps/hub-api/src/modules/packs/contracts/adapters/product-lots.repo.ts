// gap-d1 #18 · "Nhập lô" tay: tìm thành phần + khoá NCC (một câu), rồi ghi qua ĐÚNG đường `applyDelivery` của V2-B/V2-D (khoá thành
// phần, lô mới, dòng sổ `manual`, tồn/BQ) — luật kho không đổi. Tx do `PackUow` mở (RLS tenant + M1).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { LotsRepo } from "../application/product-lots.usecase";
import { one } from "./ledger-sql";
import { applyDelivery } from "./stock.repo";

export function lotsRepo(tx: Tx, t: string): LotsRepo {
  const resolve: LotsRepo["resolve"] = (productId, componentId, s) =>
    one(
      tx,
      sql`select jsonb_build_object('component_id', c.id, 'mode', c.mode,
          'party_key', case when ${s?.name ?? null}::text is null then null
            else contracts.party_key(${s?.name ?? null}::text, ${s?.tax_id ?? null}::text) end) as j
        from contracts.products p join contracts.product_components c on c.tenant_id = p.tenant_id and c.product_id = p.id
        where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid
          and c.id = coalesce(${componentId}::uuid, (select c2.id from contracts.product_components c2
            where c2.tenant_id = p.tenant_id and c2.product_id = p.id and c2.mode in ('stock', 'quota')
            order by c2.ord limit 1))`,
    );
  const receive: LotsRepo["receive"] = (move, on) => applyDelivery(tx, [move], { tenantId: t, on });
  return { resolve, receive };
}
