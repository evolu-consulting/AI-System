// CR-097 G1 · câu ĐỌC của Giao dịch — mỗi hàm MỘT câu văn bản cố định, lọc `tenant_id` tường minh ngoài RLS (Luật 4c). Danh sách đi
// index `transactions_list_idx` (ngày phát sinh, id giảm dần); chi tiết gộp dòng bản hiện hành + nghĩa vụ + vết trong một lượt.
import type { TransactionListQuery } from "@ai/contracts";
import { sql } from "drizzle-orm";

const pgArr = (ids: readonly string[]) => `{${ids.join(",")}}`;

export const summaryJson =
  sql.raw(`jsonb_build_object('id', x.id, 'deal', x.deal, 'status', x.status, 'rev', x.rev,
  'occurred_on', x.occurred_on, 'due_on', x.due_on, 'partner_name', x.partner_name, 'party_key', x.party_key,
  'contract_id', x.contract_id, 'total', x.total, 'lot_label', x.lot_label, 'updated_at', x.updated_at)`);

export function listQ(t: string, q: TransactionListQuery) {
  const off = (q.page - 1) * q.limit;
  return sql`with f as materialized (
      select x.* from contracts.transactions x
      where x.tenant_id = ${t}::uuid
        and (${q.status ?? null}::text is null or x.status = ${q.status ?? null}::text)
        and (${q.deal ?? null}::text is null or x.deal = ${q.deal ?? null}::text)
        and (${q.contract_id ?? null}::uuid is null or x.contract_id = ${q.contract_id ?? null}::uuid)
        and (${q.from ?? null}::date is null or x.occurred_on >= ${q.from ?? null}::date)
        and (${q.to ?? null}::date is null or x.occurred_on <= ${q.to ?? null}::date)
        and (${q.q ?? null}::text is null
          or strpos(contracts.fold(x.partner_name), contracts.fold(${q.q ?? null}::text)) > 0))
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(${summaryJson} order by x.occurred_on desc, x.id desc)
        from (select * from f order by f.occurred_on desc, f.id desc limit ${q.limit}::int offset ${off}::int) x),
        '[]'::jsonb),
      'total', (select count(*) from f), 'page', ${q.page}::int, 'limit', ${q.limit}::int) as j`;
}

export function detailQ(t: string, id: string) {
  return sql`select ${summaryJson} || jsonb_build_object('valid_until', x.valid_until,
      'partner_tax_id', x.partner_tax_id, 'product_group', x.product_group, 'note', x.note, 'holder', x.holder,
      'created_by', x.created_by, 'created_at', x.created_at, 'posted_at', x.posted_at, 'cancelled_at', x.cancelled_at,
      'cancel_reason', x.cancel_reason,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ord', l.ord, 'name', l.name,
          'product_id', l.product_id, 'component_ids', l.component_ids, 'unit', l.unit, 'qty', trim_scale(l.qty)::text,
          'unit_price', l.unit_price, 'amount', l.amount) order by l.ord)
        from contracts.transaction_lines l
        where l.tenant_id = ${t}::uuid and l.transaction_id = x.id and l.rev = x.rev), '[]'::jsonb),
      'obligations', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'direction', o.direction, 'seq', o.seq,
          'due_date', o.due_date, 'amount', o.amount, 'status', o.status, 'cancel_reason', o.cancel_reason)
          order by o.seq, o.created_at)
        from contracts.obligations o where o.tenant_id = ${t}::uuid and o.transaction_id = x.id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id::text, 'type', e.type,
          'actor_user_id', e.actor_user_id, 'reason', e.reason, 'data', e.data, 'at', e.at) order by e.id)
        from contracts.transaction_events e where e.tenant_id = ${t}::uuid and e.transaction_id = x.id), '[]'::jsonb)
    ) as j
    from contracts.transactions x where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid`;
}

export const lockQ = (
  t: string,
  id: string,
) => sql`select jsonb_build_object('id', x.id, 'status', x.status,
    'deal', x.deal, 'rev', x.rev, 'occurred_on', x.occurred_on, 'due_on', x.due_on, 'valid_until', x.valid_until,
    'party_key', x.party_key, 'product_group', x.product_group, 'total', x.total, 'note', x.note, 'holder', x.holder,
    'lot_label', x.lot_label) as j
  from contracts.transactions x where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid for update`;

export const compsQ = (t: string, productIds: readonly string[]) => sql`select coalesce(jsonb_agg(
    jsonb_build_object('id', pc.id, 'productId', pc.product_id, 'name', pc.name, 'mode', pc.mode, 'ord', pc.ord)
    order by pc.product_id, pc.ord), '[]'::jsonb) as j
  from contracts.product_components pc
  where pc.tenant_id = ${t}::uuid and pc.product_id = any(${pgArr(productIds)}::uuid[])`;

export const linesQ = (t: string, id: string, rev: number) => sql`select coalesce(jsonb_agg(
    jsonb_build_object('id', l.id, 'ord', l.ord, 'name', l.name, 'productId', l.product_id,
      'componentIds', l.component_ids, 'unit', l.unit, 'qty', trim_scale(l.qty)::text, 'unitPrice', l.unit_price,
      'amount', l.amount) order by l.ord), '[]'::jsonb) as j
  from contracts.transaction_lines l
  where l.tenant_id = ${t}::uuid and l.transaction_id = ${id}::uuid and l.rev = ${rev}::int`;
