// HD7-FR-03…08 · HD7 plan §2 · D7-02 · D7-15 · D7-16: câu GHI của sổ thanh toán. Tx do `PackUow` mở (RLS tenant); lọc
// `tenant_id` tường minh ngoài RLS. Khoá: hàng HĐ (`FOR NO KEY UPDATE`, như HD4 D4-12) rồi hàng đợt (`FOR UPDATE`) — hai câu riêng để
// thứ tự khoá được bảo đảm. Mỗi lệnh ghi = MỘT CTE (đợt + sổ đối tác + nhật ký HĐ); số câu không phụ thuộc số đợt.
import type { Obligation, PartnerEvent } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { LedgerWriteRepo, LockedObligation } from "../application/ledger.ports";
import { auditCte, eventCte, evJson, json, obJson, one, seenEvent } from "./ledger-sql";

export function ledgerWriteRepo(tx: Tx, t: string): LedgerWriteRepo {
  const lockContract: LedgerWriteRepo["lockContract"] = async (id) => {
    const [r] = await tx.execute<{ id: string }>(sql`select id::text from contracts.contracts
      where id = ${id}::uuid and tenant_id = ${t}::uuid for no key update`);
    return r ?? null;
  };
  const lockContractOf: LedgerWriteRepo["lockContractOf"] = async (obId) => {
    const [r] = await tx.execute<{ id: string }>(sql`select c.id::text from contracts.contracts c
      where c.tenant_id = ${t}::uuid and c.id = (select o.contract_id from contracts.obligations o
        where o.id = ${obId}::uuid and o.tenant_id = ${t}::uuid and o.status <> 'replaced')
      for no key update`);
    return r ?? null;
  };
  const lockObligation: LedgerWriteRepo["lockObligation"] = (id) =>
    one<LockedObligation | null>(
      tx,
      sql`select ${obJson("o")} as j from contracts.obligations o
        where o.id = ${id}::uuid and o.tenant_id = ${t}::uuid and o.status <> 'replaced' for update`,
    );

  /** `replace_schedule`: đợt đã xong giữ; còn lại ⇒ `replaced` (D7-02) + huỷ dòng quá hạn của chúng (hệ thống); đợt mới nối số. */
  const replaceSchedule: LedgerWriteRepo["replaceSchedule"] = (contractId, rows, by) =>
    one<Obligation[]>(
      tx,
      sql`with old as (
        update contracts.obligations o set status = 'replaced', updated_at = now()
        where o.tenant_id = ${t}::uuid and o.contract_id = ${contractId}::uuid and o.status in ('open', 'cancelled')
        returning o.id),
      vo as (
        insert into contracts.partner_event_voids (event_id, tenant_id, by_user)
        select e.id, e.tenant_id, null from contracts.partner_events e join old on e.obligation_id = old.id
        where e.tenant_id = ${t}::uuid and e.type = 'overdue'
        on conflict (event_id, tenant_id) do nothing),
      k as (
        select c.id, c.direction, contracts.party_key(
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value') as party,
          (select coalesce(max(d.seq), 0) from contracts.obligations d
            where d.tenant_id = ${t}::uuid and d.contract_id = c.id and d.status = 'done') as start
        from contracts.contracts c where c.tenant_id = ${t}::uuid and c.id = ${contractId}::uuid),
      ins as (
        insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
        select ${t}::uuid, k.id, k.party, case when k.direction = 'sale' then 'receive' else 'pay' end, x.kind,
          k.start + x.ord, x.due_date, x.amount, 'manual'
        from k, jsonb_to_recordset(${json(rows.map((r, i) => ({ ...r, ord: i + 1 })))})
          as x (ord int, due_date date, amount bigint, kind text)
        returning *),
      a as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${t}::uuid, k.id, 'schedule_set', ${by}::uuid,
          jsonb_build_object('rows', ${rows.length}::int, 'replaced', (select count(*) from old)) from k),
      q as (
        select * from contracts.obligations d
        where d.tenant_id = ${t}::uuid and d.contract_id = ${contractId}::uuid and d.status = 'done'
        union all select * from ins)
      select coalesce(jsonb_agg(${obJson("q")} order by q.seq), '[]'::jsonb) as j from q`,
    );

  const settle: LedgerWriteRepo["settle"] = (w) =>
    one<Obligation>(
      tx,
      sql`with u as (
        update contracts.obligations o set status = 'done', done_at = ${w.at}::date, done_by = ${w.by}::uuid,
          updated_at = now()
        where o.tenant_id = ${t}::uuid and o.id = ${w.id}::uuid and o.status = 'open' returning o.*),
      ${eventCte(t, { role: w.role, type: w.type, at: w.at, by: w.by, late: w.late, amount: sql`${w.amount}::bigint` })},
      ${auditCte(t, "obligation_settled", w.by, sql`jsonb_build_object('obligation_id', u.id, 'at', ${w.at}::text, 'amount', ${w.amount}::bigint)`)}
      select ${obJson("u")} as j from u`,
    );

  const postpone: LedgerWriteRepo["postpone"] = (w) =>
    one<Obligation>(
      tx,
      sql`with u as (
        update contracts.obligations o set due_date = ${w.to}::date, postponed_to = ${w.to}::date,
          postpones = o.postpones + 1, updated_at = now()
        where o.tenant_id = ${t}::uuid and o.id = ${w.id}::uuid and o.status = 'open' returning o.*),
      ${eventCte(t, { role: w.role, type: "postponed", at: w.today, by: w.by, note: w.note, data: { to: w.to, was: w.was } })},
      ${auditCte(t, "obligation_postponed", w.by, sql`jsonb_build_object('obligation_id', u.id, 'to', ${w.to}::text, 'was', ${w.was}::text)`)}
      select ${obJson("u")} as j from u`,
    );

  const remind: LedgerWriteRepo["remind"] = (w) =>
    one<Obligation>(
      tx,
      sql`with u as (
        update contracts.obligations o set reminders = o.reminders + 1, updated_at = now()
        where o.tenant_id = ${t}::uuid and o.id = ${w.id}::uuid and o.status = 'open' returning o.*),
      ${eventCte(t, { role: w.role, type: "reminded", at: w.today, by: w.by })},
      ${auditCte(t, "obligation_reminded", w.by, sql`jsonb_build_object('obligation_id', u.id)`)}
      select ${obJson("u")} as j from u`,
    );

  return {
    lockContract,
    lockContractOf,
    lockObligation,
    replaceSchedule,
    settle,
    postpone,
    remind,
    ...ledgerEventWrites(tx, t),
  };
}

/** Huỷ (hàng `partner_event_voids`, D7-16) + ghi tay — tách để file ≤ 400 dòng. */
function ledgerEventWrites(
  tx: Tx,
  t: string,
): Pick<LedgerWriteRepo, "eventHead" | "voidEvent" | "insertManual"> {
  return {
    eventHead: async (id) => {
      const [r] = await tx.execute<{
        id: string;
        type: string;
        source: string;
        obligation_id: string | null;
        to: string | null;
        was: string | null;
      }>(sql`select e.id::text, e.type, e.source, e.obligation_id::text, e.data ->> 'to' as "to",
          e.data ->> 'was' as was
        from contracts.partner_events e where e.tenant_id = ${t}::uuid and e.id = ${id}::bigint
          and ${seenEvent("e")}`);
      return r ?? null;
    },
    voidEvent: (w) => {
      const p = w.patch;
      const reopen = !!p && "reopen" in p;
      const due = p && "due_date" in p ? p : null;
      const rem = p && "reminders" in p ? p.reminders : null;
      return one<PartnerEvent>(
        tx,
        sql`with v as (
          insert into contracts.partner_event_voids (event_id, tenant_id, by_user)
          values (${w.id}::bigint, ${t}::uuid, ${w.by}::uuid) on conflict (event_id, tenant_id) do nothing
          returning event_id, by_user, at),
        u as (
          update contracts.obligations o set
            status = case when ${reopen}::boolean then 'open' else o.status end,
            done_at = case when ${reopen}::boolean then null else o.done_at end,
            done_by = case when ${reopen}::boolean then null else o.done_by end,
            due_date = coalesce(${due?.due_date ?? null}::date, o.due_date),
            postpones = coalesce(${due?.postpones ?? null}::int, o.postpones),
            postponed_to = case when ${due?.clearPostponed ?? false}::boolean then null else o.postponed_to end,
            reminders = coalesce(${rem}::int, o.reminders),
            updated_at = now()
          where o.tenant_id = ${t}::uuid and o.id = ${w.obligationId}::uuid and ${p !== null}::boolean
            and exists (select 1 from v)
          returning o.id, o.contract_id),
        ${auditCte(t, "event_voided", w.by, sql`jsonb_build_object('event_id', ${w.id}::text, 'obligation_id', u.id)`)}
        select ${evJson("e", "x")} || jsonb_build_object('voided', true,
            'voided_by', coalesce((select v.by_user from v), x.by_user),
            'voided_at', coalesce((select v.at from v), x.at)) as j
        from contracts.partner_events e left join contracts.partner_event_voids x on x.event_id = e.id
        where e.tenant_id = ${t}::uuid and e.id = ${w.id}::bigint`,
      );
    },
    insertManual: (w) =>
      one<PartnerEvent | null>(
        tx,
        sql`with e as (
          insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, contract_id,
            days_late, note, data)
          select ${t}::uuid, ${w.party}, ${w.role}, ${w.type}, ${w.at}::date, ${w.by}::uuid, 'action',
            ${w.contract_id ?? null}::uuid, ${w.days_late ?? null}::int, ${w.note ? w.note : null}::text,
            ${json(w.delta == null ? {} : { delta: w.delta })}
          where exists (select 1 from contracts.obligations o where o.tenant_id = ${t}::uuid and o.party_key = ${w.party})
             or exists (select 1 from contracts.partner_events p where p.tenant_id = ${t}::uuid and p.party_key = ${w.party})
             -- M1e (UAT B2): đối tác là một bên của HĐ CỦA MÌNH (tạo/phụ trách) — kể cả HĐ tự duyệt chưa có đợt. Chỉ mở GHI;
             -- đọc vẫn theo luật thấy (việc mình ghi: by_user; việc người khác: khoá bên của HĐ được người khác duyệt).
             or exists (select 1 from contracts.contracts k
               where k.tenant_id = ${t}::uuid and (k.owner_user_id = ${w.by}::uuid or k.created_by = ${w.by}::uuid)
                 and ${w.party} in (
                   contracts.party_key(k.fields -> 'buyer_name' ->> 'value', k.fields -> 'buyer_tax_id' ->> 'value'),
                   contracts.party_key(k.fields -> 'supplier_name' ->> 'value', k.fields -> 'supplier_tax_id' ->> 'value')))
          returning *)
        select ${evJson("e", "x")} as j from e left join contracts.partner_event_voids x on false`,
      ),
  };
}
