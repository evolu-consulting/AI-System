// HD7-FR-10 · HD7-NFR-03 · HD7 plan §4 · D7-07 · D7-08 · D7-18: câu ĐỌC của sổ thanh toán — mỗi hàm MỘT câu SQL văn bản cố định,
// lọc `tenant_id` tường minh ngoài RLS. Bảng Thanh toán = `payments.board`: tổng (NUMERIC ⇒ chuỗi) trên mọi đợt tiền đang mở, không
// theo bộ lọc; hàng ≤ 500 theo (`due_date`, `id`) — `days_late` giảm dần ≡ hạn tăng dần — hoặc `done_at` giảm dần (60 ngày).
// HĐ không xoá được (D-08) nên tổng/đếm không cần join HĐ; chi tiết HĐ chỉ join cho ≤ 500 hàng trả về.
import type { ContractPartner, Obligation, PartnerEvent, PaymentsOut } from "@ai/contracts";
import { LEDGER_LIST_MAX } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { LedgerReadRepo } from "../application/ledger.ports";
import { addDays } from "../domain/local-time.rules";
import { evJson, obJson, one, seenEvent } from "./ledger-sql";

/** `payments.DONE_DAYS`: "Đã xong" = 60 ngày gần nhất. */
export const DONE_DAYS = 60;

/** Cột của một hàng bảng (`payments.board`): đối tác = bên mua (bán) / bên bán (mua) — tên thô như mgmt. */
const boardRow = (today: string) => sql`jsonb_build_object('id', r.id, 'contract_id', r.contract_id,
    'party_key', r.party_key, 'direction', r.direction, 'kind', r.kind, 'seq', r.seq, 'due_date', r.due_date,
    'amount', r.amount, 'status', r.status, 'done_at', r.done_at, 'postponed_to', r.postponed_to,
    'postpones', r.postpones, 'reminders', r.reminders, 'source', r.source, 'estimated', r.estimated, 'basis', r.basis,
    'of', (select count(*) from contracts.obligations x
           where x.tenant_id = r.tenant_id and x.contract_id = r.contract_id and x.status <> 'replaced'),
    'party', case when c.direction = 'sale' then c.fields -> 'buyer_name' ->> 'value'
                  else c.fields -> 'supplier_name' ->> 'value' end,
    'contract_title', coalesce(nullif(c.fields -> 'title' ->> 'value', ''), nullif(c.fields -> 'number' ->> 'value', ''),
                               c.title),
    'days_late', case when r.status = 'open' then greatest(0, ${today}::date - r.due_date) else 0 end)`;

function statsQ(t: string, today: string): SQL {
  return sql`select jsonb_build_object(
      'receive_open', coalesce(sum(o.amount) filter (where o.direction = 'receive'), 0)::text,
      'pay_open', coalesce(sum(o.amount) filter (where o.direction = 'pay'), 0)::text,
      'overdue_count', count(*) filter (where o.due_date < ${today}::date),
      'overdue_amount', coalesce(sum(o.amount) filter (where o.due_date < ${today}::date), 0)::text,
      'due_7d', coalesce(sum(o.amount) filter (
        where o.due_date >= ${today}::date and o.due_date <= ${addDays(today, 7)}::date), 0)::text)
    from contracts.obligations o where o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind = 'payment'`;
}

function openPage(t: string, filter: string, today: string): SQL {
  const dir = filter === "receive" || filter === "pay" ? filter : null;
  const late = filter === "overdue";
  const where = sql`o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind = 'payment'
    and (${dir}::text is null or o.direction = ${dir}::text) and (not ${late}::boolean or o.due_date < ${today}::date)`;
  return sql`with r as (select o.* from contracts.obligations o where ${where} order by o.due_date, o.id
      limit ${LEDGER_LIST_MAX}::int)
    select jsonb_build_object('stats', (${statsQ(t, today)}),
      'total', (select count(*) from contracts.obligations o where ${where}),
      'rows', coalesce((select jsonb_agg(${boardRow(today)} order by r.due_date, r.id)
        from r left join contracts.contracts c on c.tenant_id = r.tenant_id and c.id = r.contract_id), '[]'::jsonb)) as j`;
}

function donePage(t: string, today: string): SQL {
  const where = sql`o.tenant_id = ${t}::uuid and o.status = 'done' and o.kind = 'payment'
    and o.done_at >= ${addDays(today, -DONE_DAYS)}::date`;
  return sql`with r as (select o.* from contracts.obligations o where ${where}
      order by o.done_at desc, o.due_date, o.id limit ${LEDGER_LIST_MAX}::int)
    select jsonb_build_object('stats', (${statsQ(t, today)}),
      'total', (select count(*) from contracts.obligations o where ${where}),
      'rows', coalesce((select jsonb_agg(${boardRow(today)} order by r.done_at desc, r.due_date, r.id)
        from r left join contracts.contracts c on c.tenant_id = r.tenant_id and c.id = r.contract_id), '[]'::jsonb)) as j`;
}

export function ledgerReadRepo(tx: Tx, t: string): LedgerReadRepo {
  return {
    payments: (filter, today) =>
      one<PaymentsOut>(tx, filter === "done" ? donePage(t, today) : openPage(t, filter, today)),
    obligations: (q) =>
      one<Obligation[]>(
        tx,
        sql`with o as (
          select * from contracts.obligations o where o.tenant_id = ${t}::uuid and o.status <> 'replaced'
            and (${q.contract_id ?? null}::uuid is null or o.contract_id = ${q.contract_id ?? null}::uuid)
            and (${q.party ?? null}::text is null or o.party_key = ${q.party ?? null}::text)
            and (${q.status ?? null}::text is null or o.status = ${q.status ?? null}::text)
            and (${q.direction ?? null}::text is null or o.direction = ${q.direction ?? null}::text)
            and (${q.due_before ?? null}::date is null or o.due_date <= ${q.due_before ?? null}::date)
          order by o.due_date, o.seq, o.id limit ${LEDGER_LIST_MAX}::int)
        select coalesce(jsonb_agg(${obJson("o")} || jsonb_build_object('contract_number',
            coalesce(nullif(c.fields -> 'number' ->> 'value', ''), c.title)) order by o.due_date, o.seq, o.id),
          '[]'::jsonb) as j
        from o left join contracts.contracts c on c.tenant_id = o.tenant_id and c.id = o.contract_id`,
      ),
    events: (party, role) =>
      one<PartnerEvent[]>(
        tx,
        sql`with e as (
          select * from contracts.partner_events e where e.tenant_id = ${t}::uuid and e.party_key = ${party}
            and (${role}::text is null or e.role = ${role}::text) and ${seenEvent("e")}
          order by e.at desc, e.id desc limit 2000)
        select coalesce(jsonb_agg(${evJson("e", "v")} order by e.at, e.id), '[]'::jsonb) as j
        from e left join contracts.partner_event_voids v on v.event_id = e.id and v.tenant_id = e.tenant_id`,
      ),
    contractPartner: (id) =>
      one<ContractPartner | null>(
        tx,
        sql`select jsonb_build_object(
            'party', contracts.party_key(c.fields -> (s.side || '_name') ->> 'value', c.fields -> (s.side || '_tax_id') ->> 'value'),
            'role', case when c.direction = 'sale' then 'customer' else 'supplier' end,
            'name', c.fields -> (s.side || '_name') ->> 'value') as j
          from contracts.contracts c,
            lateral (select case when c.direction = 'sale' then 'buyer' else 'supplier' end as side) s
          where c.tenant_id = ${t}::uuid and c.id = ${id}::uuid`,
      ),
  };
}
