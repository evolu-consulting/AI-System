// CR-101 DOC-deals · lớp tương thích ĐỌC `/transactions*` (UI G2 cũ, gỡ ở DOC-ui-list): giao dịch giờ là chứng từ `doc_type = 'deal'`
// ⇒ map hàng `contracts` (bản hiện hành, Mua/Bán) sang hình DTO G1 (`TransactionSummary`/`TransactionDetail`). Mỗi hàm MỘT câu văn bản
// cố định, lọc `tenant_id` tường minh ngoài RLS (Luật 4c); danh sách đi index một phần `contracts_deal_idx`.
// Trạng thái: `rejected` (huỷ khi chuyển G1) ⇒ `cancelled`, còn lại ⇒ `posted` (`deal.rules.ts::legacyStatus`). `rev` = 0.
import type { TransactionListQuery } from "@ai/contracts";
import { sql } from "drizzle-orm";

const PARTNER = `case c.direction when 'purchase' then c.seller else c.buyer end`;
const DAY = `coalesce(c.start_date, (c.created_at at time zone 'UTC')::date)`;

export const summaryJson = sql.raw(`jsonb_build_object('id', c.id, 'deal', c.deal,
  'status', case c.status when 'rejected' then 'cancelled' else 'posted' end, 'rev', 0,
  'occurred_on', ${DAY}, 'due_on', c.end_date, 'partner_name', coalesce(${PARTNER}, c.title), 'party_key', c.partner_key,
  'contract_id', null, 'total', coalesce(c.value, 0), 'lot_label', null, 'updated_at', c.updated_at)`);

export function listQ(t: string, q: TransactionListQuery) {
  const off = (q.page - 1) * q.limit;
  const st = q.status ?? null;
  return sql`with f as materialized (
      select c.* from contracts.contracts c
      where c.tenant_id = ${t}::uuid and c.doc_type = 'deal' and c.superseded_at is null and c.deal in ('buy', 'sell')
        and (${st}::text is null or (${st}::text = 'cancelled') = (c.status = 'rejected'))
        and (${st}::text is distinct from 'draft')
        and (${q.deal ?? null}::text is null or c.deal = ${q.deal ?? null}::text)
        and (${q.contract_id ?? null}::uuid is null or c.frame_root_id = ${q.contract_id ?? null}::uuid)
        and (${q.from ?? null}::date is null or ${sql.raw(DAY)} >= ${q.from ?? null}::date)
        and (${q.to ?? null}::date is null or ${sql.raw(DAY)} <= ${q.to ?? null}::date)
        and (${q.q ?? null}::text is null or strpos(c.search_key, contracts.fold(${q.q ?? null}::text)) > 0))
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(${summaryJson} order by c.updated_at desc, c.id desc)
        from (select * from f order by f.updated_at desc, f.id desc limit ${q.limit}::int offset ${off}::int) c),
        '[]'::jsonb),
      'total', (select count(*) from f), 'page', ${q.page}::int, 'limit', ${q.limit}::int) as j`;
}

export function detailQ(t: string, id: string) {
  return sql`select ${summaryJson} || jsonb_build_object('valid_until', c.end_date,
      'partner_tax_id', case c.direction when 'purchase' then c.fields -> 'supplier_tax_id' ->> 'value'
        else c.fields -> 'buyer_tax_id' ->> 'value' end,
      'product_group', case when c.product_group in ('service', 'goods') then c.product_group end, 'note', null,
      'holder', null, 'created_by', c.created_by, 'created_at', c.created_at, 'posted_at', c.confirmed_at,
      'cancelled_at', case c.status when 'rejected' then c.updated_at end, 'cancel_reason', null,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'ord', i.ord, 'name', i.name,
          'product_id', i.product_id, 'component_ids', i.component_ids, 'unit', i.unit,
          'qty', coalesce(trim_scale(i.qty)::text, '0'), 'unit_price', coalesce(i.unit_price, 0),
          'amount', coalesce(round(i.qty * i.unit_price)::bigint, 0)) order by i.ord)
        from contracts.contract_items i where i.tenant_id = ${t}::uuid and i.contract_id = c.id), '[]'::jsonb),
      'obligations', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'direction', o.direction, 'seq', o.seq,
          'due_date', o.due_date, 'amount', o.amount, 'status', o.status, 'cancel_reason', o.cancel_reason)
          order by o.seq, o.created_at)
        from contracts.obligations o where o.tenant_id = ${t}::uuid and o.contract_id = c.id and o.kind = 'payment'),
        '[]'::jsonb),
      'events', '[]'::jsonb) as j
    from contracts.contracts c
    where c.tenant_id = ${t}::uuid and c.id = ${id}::uuid and c.doc_type = 'deal' and c.deal in ('buy', 'sell')`;
}
