// products-confirm · BA 5.5: gắn/tạo SP cho dòng HĐ — CHỈ khi HĐ đã xác nhận (không còn chờ xác nhận / đang đọc / lỗi / từ chối).
// MỘT câu (set-based, văn bản cố định, lô qua một tham số JSON): SP mới (trùng tên ⇒ dùng SP có sẵn cùng tên) + thành phần mặc định
// (`created_from_contract_id` = HĐ) → gắn dòng HĐ → sự kiện `item_product_set`. HĐ đã có dòng kho ⇒ khoá (không đổi gì).
import type { ProductLink } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ProductLinksRepo } from "../application/product-links.usecase";

type Row = { found: boolean; confirmed: boolean; locked: boolean; created: number; linked: number };

/** Dòng gửi vào SQL: SP có sẵn (`product_id`) hoặc SP mới (`name/unit/grp`). */
export const linkRows = (links: readonly ProductLink[]) =>
  links.map((l) =>
    "product_id" in l
      ? { item_id: l.item_id, product_id: l.product_id, name: null, unit: null, grp: null }
      : {
          item_id: l.item_id,
          product_id: null,
          name: l.new_product.name.trim(),
          unit: l.new_product.unit?.trim() || null,
          grp: l.new_product.group,
        },
  );

export function productLinksRepo(tx: Tx, t: string): ProductLinksRepo {
  return {
    link: async (contractId, links, actor) => {
      const rows = await tx.execute<Row>(sql`with k as (
          select c.id, c.deal, c.fields,
            c.status not in ('needs_review', 'extracting', 'extract_failed', 'rejected') as confirmed,
            exists (select 1 from contracts.stock_moves m where m.tenant_id = c.tenant_id and m.contract_id = c.id) as locked
          from contracts.contracts c where c.tenant_id = ${t}::uuid and c.id = ${contractId}::uuid),
        ok as (select k.* from k where k.confirmed and not k.locked),
        x as (select x.* from ok, jsonb_to_recordset(${JSON.stringify(linkRows(links))}::jsonb)
            as x (item_id uuid, product_id uuid, name text, unit text, grp text)
          where exists (select 1 from contracts.contract_items i
            where i.tenant_id = ${t}::uuid and i.contract_id = ok.id and i.id = x.item_id)),
        nw as (select distinct on (contracts.fold(x.name)) x.name, x.unit, x.grp from x
          where x.product_id is null and x.name is not null order by contracts.fold(x.name), x.item_id),
        p as (
          insert into contracts.products (tenant_id, name, unit, grp, main_supplier_party_key, main_supplier_name,
            created_from_contract_id)
          select ${t}::uuid, nw.name, nw.unit, nw.grp,
            case when ok.deal = 'buy' then contracts.party_key(ok.fields -> 'supplier_name' ->> 'value',
              ok.fields -> 'supplier_tax_id' ->> 'value') end,
            case when ok.deal = 'buy' then nullif(ok.fields -> 'supplier_name' ->> 'value', '') end, ok.id
          from nw, ok
          on conflict (tenant_id, name_key) do nothing
          returning id, name, name_key, unit, grp),
        pc as (
          insert into contracts.product_components (tenant_id, product_id, ord, name, unit, mode)
          select ${t}::uuid, p.id, 0, p.name, p.unit,
            case p.grp when 'service' then 'quota' when 'goods' then 'stock' else 'none' end from p
          returning product_id),
        tgt as (
          select x.item_id, coalesce(x.product_id, p.id, e.id) as pid from x
          left join p on x.product_id is null and p.name_key = contracts.fold(x.name)
          left join contracts.products e on x.product_id is null and e.tenant_id = ${t}::uuid
            and e.name_key = contracts.fold(x.name)),
        u as (
          update contracts.contract_items i set product_id = tgt.pid, component_ids = null
          from tgt where i.tenant_id = ${t}::uuid and i.contract_id = ${contractId}::uuid and i.id = tgt.item_id
            and tgt.pid is not null and i.product_id is distinct from tgt.pid
          returning i.id, i.product_id),
        ev as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, ${contractId}::uuid, 'item_product_set', ${actor}::uuid,
            jsonb_build_object('item_id', u.id, 'product_id', u.product_id, 'on_confirm', true) from u)
      select exists (select 1 from k) as found, coalesce((select confirmed from k), false) as confirmed,
        coalesce((select locked from k), false) as locked,
        (select count(*) from pc)::int as created, (select count(*) from u)::int as linked`);
      const r = rows[0];
      if (!r?.found) return { kind: "not_found" };
      if (!r.confirmed) return { kind: "not_confirmed" };
      if (r.locked) return { kind: "locked" };
      return { kind: "ok", created: r.created, linked: r.linked };
    },
  };
}
