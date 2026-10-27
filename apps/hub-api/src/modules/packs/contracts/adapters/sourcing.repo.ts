// W1 · "Mua hàng" (Luật 4c): đọc = MỘT câu SQL văn bản cố định (HĐ đã duyệt + dòng hàng + lựa chọn nguồn), lọc `tenant_id` tường minh
// ngoài RLS; gom/tính ở domain. HĐ/dòng hàng/lựa chọn của HĐ người dùng KHÔNG thấy (M1) đã bị RLS loại trước khi tới câu này.
// Giới hạn: ≤ 2.000 HĐ (báo `truncated`), ≤ 500 dòng hàng mỗi HĐ (như HD5), ≤ 20.000 lựa chọn.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SourcingRepo } from "../application/sourcing.usecase";
import type { RawSourcing } from "../domain/sourcing.rules";
import { PRICED_STATUSES } from "./appendix.repo";
import { one } from "./ledger-sql";
export const SOURCING_CONTRACTS_MAX = 2000;

const ITEMS_MAX = 500;
const CHOICES_MAX = 20_000;
const VISIBLE_MAX = 50_000;
const ME = sql`NULLIF(current_setting('app.user_id', true), '')::uuid`;
const STATUSES = sql.raw(PRICED_STATUSES.map((s) => `'${s}'`).join(", "));

export function sourcingRepo(tx: Tx, t: string): SourcingRepo {
  return {
    fingerprint: async () =>
      (await one<string>(
        tx,
        sql`select concat_ws('|',
            (select count(*)::text || ':' || coalesce(max(c.updated_at)::text, '') || ':' || coalesce(sum(c.version), 0)::text
 || ':' || coalesce(sum(hashtext(c.id::text || c.status || coalesce(c.direction, ''))), 0)::text
              from contracts.contracts c where c.tenant_id = ${t}::uuid and c.status in (${STATUSES}) and c.superseded_at is null),
            (select count(*)::text || ':' || coalesce(max(s.chosen_at)::text, '')
              from contracts.sourcing_choices s where s.tenant_id = ${t}::uuid)) as j`,
      )) ?? "",
    visibleIds: async () =>
      (await one<string[]>(
        tx,
        sql`select coalesce(json_agg(c.id), '[]'::json) as j from (select c.id from contracts.contracts c
            where c.tenant_id = ${t}::uuid and c.status in (${STATUSES}) and c.superseded_at is null limit ${VISIBLE_MAX}::int) c`,
      )) ?? [],
    load: async () => {
      const j = await one<{
        contracts: RawSourcing["contracts"];
        choices: RawSourcing["choices"];
        n: number;
      }>(tx, loadQ(t));
      return {
        contracts: j.contracts,
        choices: j.choices,
        truncated: j.n > SOURCING_CONTRACTS_MAX,
      };
    },
    itemExists: async (contractId, line) =>
      (
        await tx.execute(sql`select 1 from contracts.contract_items i
          where i.tenant_id = ${t}::uuid and i.contract_id = ${contractId}::uuid and i.ord = ${line}::int`)
      ).length > 0,
    setChoice: async (sale, src) => {
      await tx.execute(sql`insert into contracts.sourcing_choices
          (tenant_id, sale_contract_id, sale_line, source_contract_id, source_line, chosen_by)
        values (${t}::uuid, ${sale.contract_id}::uuid, ${sale.line}::smallint, ${src.contract_id}::uuid,
          ${src.line}::smallint, ${ME})
        on conflict (tenant_id, sale_contract_id, sale_line) do update set source_contract_id = excluded.source_contract_id,
          source_line = excluded.source_line, chosen_by = excluded.chosen_by, chosen_at = now()`);
    },
    clearChoice: async (sale) => {
      await tx.execute(sql`delete from contracts.sourcing_choices
        where tenant_id = ${t}::uuid and sale_contract_id = ${sale.contract_id}::uuid and sale_line = ${sale.line}::smallint`);
    },
  };
}

/** HĐ đã duyệt (≤ MAX + 1 để biết bị cắt) + dòng hàng + lựa chọn nguồn — MỘT câu. */
function loadQ(t: string) {
  return sql`with c as (
            select c.id, c.kind, c.parent_id, c.title, c.number, c.status, c.direction, c.end_date, c.created_at,
              contracts.as_date(c.fields -> 'effective_date' ->> 'value') as eff,
              json_build_object('key', contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'),
                'name', c.seller) as seller,
              json_build_object('key', contracts.party_key(c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value'),
                'name', c.buyer) as buyer
            from contracts.contracts c
            where c.tenant_id = ${t}::uuid and c.status in (${STATUSES}) and c.superseded_at is null
              and c.doc_type <> 'framework' -- CR-101: bảng giá thoả thuận không là nguồn hàng (không kho)
            order by (c.kind = 'appendix'), c.created_at, c.id limit ${SOURCING_CONTRACTS_MAX + 1}::int),
          cs as (select * from c order by (c.kind = 'appendix'), c.created_at, c.id limit ${SOURCING_CONTRACTS_MAX}::int)
          select json_build_object(
            'n', (select count(*) from c),
            'contracts', coalesce((select json_agg(json_build_object('id', x.id, 'kind', x.kind, 'parent_id', x.parent_id,
                'title', x.title, 'number', x.number, 'status', x.status, 'direction', x.direction, 'end_date', x.end_date,
                'effective_date', x.eff, 'seller', x.seller, 'buyer', x.buyer,
                'items', coalesce(it.items, '[]'::json)) order by (x.kind = 'appendix'), x.created_at, x.id)
              from cs x left join lateral (
                select json_agg(json_build_object('ord', i.ord, 'code', i.code, 'name', i.name, 'spec', i.spec,
                    'unit', i.unit, 'qty', i.qty, 'unit_price', i.unit_price, 'vat_rate', i.vat_rate,
                    'valid_from', i.valid_from, 'valid_to', i.valid_to) order by i.ord) as items
                from (select i.* from contracts.contract_items i
                  where i.tenant_id = ${t}::uuid and i.contract_id = x.id order by i.ord limit ${ITEMS_MAX}::int) i) it on true),
              '[]'::json),
            'choices', coalesce((select json_agg(json_build_object('sale_contract_id', s.sale_contract_id,
                'sale_line', s.sale_line, 'source_contract_id', s.source_contract_id, 'source_line', s.source_line))
              from (select * from contracts.sourcing_choices s where s.tenant_id = ${t}::uuid
                limit ${CHOICES_MAX}::int) s), '[]'::json)) as j`;
}
