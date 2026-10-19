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

/**
 * Một hàng bảng (`payments.board`): đối tác = bên mua (bán) / bên bán (mua) — tên thô như mgmt. Luật 4c: `json_agg` trên bản ghi của
 * truy vấn con đã sắp (Postgres đổi bản ghi ⇒ JSON một lượt, không dựng object từng cột; route gửi thẳng chữ); `of` = một lượt đếm
 * theo nhóm cho ≤ 500 HĐ (`n`); HĐ tra theo id.
 */
const rowsOf = (t: string, today: string, order: SQL) => sql`coalesce((select json_agg(x) from (
    select r.id, r.contract_id, r.party_key, r.direction, r.kind, r.seq, r.due_date, r.amount, r.status, r.done_at,
      r.postponed_to, r.postpones, r.reminders, r.source, r.estimated, r.basis, coalesce(n.of, 0) as of,
      case when c.direction = 'sale' then c.fields -> 'buyer_name' ->> 'value'
           else c.fields -> 'supplier_name' ->> 'value' end as party,
      coalesce(nullif(c.fields -> 'title' ->> 'value', ''), nullif(c.fields -> 'number' ->> 'value', ''), c.title)
        as contract_title,
      case when r.status = 'open' then greatest(0, ${today}::date - r.due_date) else 0 end as days_late
    from r left join lateral (select k.direction, k.fields, k.title from contracts.contracts k
      where k.tenant_id = r.tenant_id and k.id = r.contract_id limit 1) c on true
    left join (select y.contract_id, count(*) as of from contracts.obligations y
      where y.tenant_id = ${t}::uuid and y.contract_id in (select contract_id from r)
        and y.status <> 'replaced' group by y.contract_id) n on n.contract_id = r.contract_id
    order by ${order}) x), '[]'::json)`;
/** Tổng (không theo bộ lọc, D7-18) + `total` của bộ lọc mở — MỘT lượt quét đợt tiền đang mở. */
function statsOf(t: string, today: string, total: SQL): SQL {
  return sql`a as (select
      coalesce(sum(o.amount) filter (where o.direction = 'receive'), 0)::text as receive_open,
      coalesce(sum(o.amount) filter (where o.direction = 'pay'), 0)::text as pay_open,
      count(*) filter (where o.due_date < ${today}::date) as overdue_count,
      coalesce(sum(o.amount) filter (where o.due_date < ${today}::date), 0)::text as overdue_amount,
      coalesce(sum(o.amount) filter (
        where o.due_date >= ${today}::date and o.due_date <= ${addDays(today, 7)}::date), 0)::text as due_7d,
      ${total} as total
    from contracts.obligations o where o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind = 'payment')`;
}
const statsJson = sql`json_build_object('receive_open', a.receive_open, 'pay_open', a.pay_open,
    'overdue_count', a.overdue_count, 'overdue_amount', a.overdue_amount, 'due_7d', a.due_7d)`;

function openPage(t: string, filter: string, today: string): SQL {
  const dir = filter === "receive" || filter === "pay" ? filter : null;
  const late = filter === "overdue";
  const match = sql`(${dir}::text is null or o.direction = ${dir}::text) and (not ${late}::boolean or o.due_date < ${today}::date)`;
  return sql`with r as (select o.* from contracts.obligations o
      where o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind = 'payment' and ${match}
      order by o.due_date, o.id limit ${LEDGER_LIST_MAX}::int),
    ${statsOf(t, today, sql`count(*) filter (where ${match})`)}
    select json_build_object('stats', ${statsJson}, 'total', a.total,
      'rows', ${rowsOf(t, today, sql`r.due_date, r.id`)}) as j from a`;
}

function donePage(t: string, today: string): SQL {
  const where = sql`o.tenant_id = ${t}::uuid and o.status = 'done' and o.kind = 'payment'
    and o.done_at >= ${addDays(today, -DONE_DAYS)}::date`;
  return sql`with r as (select o.* from contracts.obligations o where ${where}
      order by o.done_at desc, o.due_date, o.id limit ${LEDGER_LIST_MAX}::int),
    ${statsOf(t, today, sql`0`)}
    select json_build_object('stats', ${statsJson},
      'total', (select count(*) from contracts.obligations o where ${where}),
      'rows', ${rowsOf(t, today, sql`r.done_at desc, r.due_date, r.id`)}) as j from a`;
}
/** Hai nửa ĐỘC LẬP của bảng (Luật 4c: chạy song song ở hai tx chỉ đọc): đầu = tổng + `total`; thân = ≤ 500 hàng. */
function boardHead(t: string, filter: string, today: string): SQL {
  if (filter === "done") {
    const where = sql`o.tenant_id = ${t}::uuid and o.status = 'done' and o.kind = 'payment'
      and o.done_at >= ${addDays(today, -DONE_DAYS)}::date`;
    return sql`with ${statsOf(t, today, sql`0`)} select json_build_object('stats', ${statsJson},
      'total', (select count(*) from contracts.obligations o where ${where}))::text as j from a`;
  }
  const dir = filter === "receive" || filter === "pay" ? filter : null;
  const late = filter === "overdue";
  const match = sql`(${dir}::text is null or o.direction = ${dir}::text) and (not ${late}::boolean or o.due_date < ${today}::date)`;
  return sql`with ${statsOf(t, today, sql`count(*) filter (where ${match})`)}
    select json_build_object('stats', ${statsJson}, 'total', a.total)::text as j from a`;
}
function boardRows(t: string, filter: string, today: string): SQL {
  if (filter === "done")
    return sql`with r as (select o.* from contracts.obligations o where o.tenant_id = ${t}::uuid and o.status = 'done'
        and o.kind = 'payment' and o.done_at >= ${addDays(today, -DONE_DAYS)}::date
        order by o.done_at desc, o.due_date, o.id limit ${LEDGER_LIST_MAX}::int)
      select ${rowsOf(t, today, sql`r.done_at desc, r.due_date, r.id`)}::text as j`;
  const dir = filter === "receive" || filter === "pay" ? filter : null;
  const late = filter === "overdue";
  return sql`with r as (select o.* from contracts.obligations o
      where o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind = 'payment'
        and (${dir}::text is null or o.direction = ${dir}::text) and (not ${late}::boolean or o.due_date < ${today}::date)
      order by o.due_date, o.id limit ${LEDGER_LIST_MAX}::int)
    select ${rowsOf(t, today, sql`r.due_date, r.id`)}::text as j`;
}

export function ledgerReadRepo(tx: Tx, t: string): LedgerReadRepo {
  return {
    payments: (filter, today) =>
      one<PaymentsOut>(tx, filter === "done" ? donePage(t, today) : openPage(t, filter, today)),
    paymentsHead: (filter, today) => one<string>(tx, boardHead(t, filter, today)),
    paymentsRows: (filter, today) => one<string>(tx, boardRows(t, filter, today)),
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
