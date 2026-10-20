// HD-FR-91 · HD-FR-92 · HD-FR-94 · HD-FR-95 · BR-2 · D9-06 · D9-21 · HD9 plan §4: câu GHI của CKS. Tx do `PackUow` mở (RLS);
// `lock` là câu đầu mọi lệnh ghi; mỗi hàm còn lại MỘT câu (CTE ghi nhiều bảng, dữ liệu lô qua MỘT tham số JSON) — số câu không
// phụ thuộc số chữ ký/người giữ/tệp. Nhật ký giá ghi trong cùng câu với lệnh đặt giá (BR-2).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { AuditWrite, CksRepo, ContractWrite, RenewalOut } from "../application/ports";

type J<T> = { j: T };
const one = async <T>(tx: Tx, q: SQL): Promise<T> =>
  ((await tx.execute<J<T>>(q))[0]?.j ?? null) as T;
const json = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`;
/** Người làm = `app.user_id` do `withPackScope` đặt từ token (không bao giờ từ thân request — PK-AC10). */
const BY = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

/** CTE dựng HĐ + 1 dòng hàng + event `created_cks` (đặt sau `with`, trước CTE khác). */
function contractCtes(t: string, c: ContractWrite): SQL {
  return sql`k as (
      -- M1d (N-1): HĐ bán/mua CKS tự vào "đã duyệt" bởi chính người ghi ⇒ ghi người duyệt = người tạo (tự duyệt — không mở đối tác
      -- ngoài chính HĐ này, xem migration 0019).
      insert into contracts.contracts (id, tenant_id, kind, title, direction, status, owner_user_id, created_by, fields,
        confirmed_by, confirmed_at)
      values (${c.id}::uuid, ${t}::uuid, 'contract', ${c.title}, ${c.direction}, 'active', ${BY}, ${BY},
        ${json(c.fields)}, ${BY}, now())
      returning id, direction, fields),
    ko as (
      -- HD7-FR-11 (sales.py:58, lots.py:33, sales.py:102): một đợt = số chữ ký × giá (NUMERIC, > 10¹⁵ ⇒ null), hạn = ngày ký
      -- hoặc due (gia hạn: hôm nay + 15); đối tác như obligations.counterparty.
      insert into contracts.obligations (tenant_id, contract_id, party_key, direction, seq, due_date, amount, source)
      select ${t}::uuid, k.id, contracts.party_key(
          k.fields -> (case when k.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
          k.fields -> (case when k.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value'),
        case when k.direction = 'sale' then 'receive' else 'pay' end, 1, x.due,
        case when x.amt between 0 and 1000000000000000 then x.amt::bigint end, 'cks'
      from k, lateral (select coalesce(${c.due ?? null}::date, contracts.as_date(k.fields -> 'signed_date' ->> 'value')) as due,
        ${c.item.qty}::numeric * ${c.item.unit_price}::numeric as amt) x
      where x.due is not null),
    ki as (
      insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited)
      select ${t}::uuid, k.id, 0, ${c.item.name}, ${c.item.unit}, ${c.item.qty}::numeric, ${c.item.unit_price}::bigint,
        true, true from k),
    ke as (
      insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select ${t}::uuid, k.id, 'created_cks', ${BY}, '{}'::jsonb from k)`;
}

function auditCte(t: string, a: readonly AuditWrite[]): SQL {
  return sql`au as (
      insert into contracts.cks_price_audit (tenant_id, entity, entity_id, field, old_value, new_value, actor_user_id)
      select ${t}::uuid, x.entity, x.entity_id, x.field, x.old_value, x.new_value, ${BY}
      from jsonb_to_recordset(${json(a)}) as x (ord int, entity text, entity_id uuid, field text, old_value bigint,
        new_value bigint)
      order by x.ord)`;
}
const withOrd = (a: readonly AuditWrite[]) => a.map((x, ord) => ({ ...x, ord }));

const CERT_COLS = sql`id uuid, serial text, serial_key text, ca text, device text, holder_name text, holder_title text,
  keeper text, valid_from date, valid_to date, source text, lot_id uuid, sale_contract_id uuid, sale_price bigint`;

export function cksWriteRepo(tx: Tx, t: string) {
  const lock: CksRepo["lock"] = async () => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`cks:${t}`}, 0))`);
  };
  const saleCheck: CksRepo["saleCheck"] = (i) =>
    one(
      tx,
      sql`select jsonb_build_object(
        'lot', (select jsonb_build_object('id', l.id, 'ca', l.ca, 'qty', l.qty, 'years', l.years,
            'sold', (select count(*) from contracts.cks_certificates c
                     where c.tenant_id = ${t}::uuid and c.lot_id = l.id and c.replaces is null))
          from contracts.cks_lots l where l.tenant_id = ${t}::uuid and l.id = ${i.lotId}::uuid),
        'taken', coalesce((select jsonb_agg(c.serial_key) from contracts.cks_certificates c
          where c.tenant_id = ${t}::uuid
            and c.serial_key in (select jsonb_array_elements_text(${json(i.serialKeys)}))), '[]'::jsonb),
        'customer_id', (select cu.id from contracts.cks_customers cu where cu.tenant_id = ${t}::uuid
          and case when ${i.tax}::text is not null then cu.tax_id = ${i.tax}::text
                   else cu.tax_id is null and cu.name_key = contracts.fold(${i.name}::text) end limit 1),
        'numbers', coalesce((select jsonb_agg(k.number) from contracts.contracts k
          where k.tenant_id = ${t}::uuid and ${i.year}::text is not null
            and k.number like 'CKS-' || ${i.year}::text || '-%'), '[]'::jsonb)) as j`,
    );
  const insertLot: CksRepo["insertLot"] = async (w) => {
    const l = w.lot;
    await tx.execute(sql`with ${contractCtes(t, w.contract)},
      lo as (
        insert into contracts.cks_lots (id, tenant_id, label, ca, qty, unit_cost, years, device, bought_at,
          purchase_contract_id, created_by)
        select ${l.id}::uuid, ${t}::uuid, ${l.label}, ${l.ca}, ${l.qty}::int, ${l.unit_cost}::bigint, ${l.years}::smallint,
          ${l.device}, ${l.bought_at}::date, k.id, ${BY} from k),
      ${auditCte(t, withOrd(w.audit))}
      select 1`);
  };
  const insertSale: CksRepo["insertSale"] = async (w) => {
    const cu = w.customer;
    await tx.execute(sql`with
      cu as (
        insert into contracts.cks_customers (id, tenant_id, name, tax_id)
        select ${cu.id}::uuid, ${t}::uuid, ${cu.name}, ${cu.tax_id}::text where ${cu.isNew}::boolean
        returning id),
      ${w.contract ? contractCtes(t, w.contract) : sql`k as (select null::uuid as id), ko as (select 1), ki as (select 1), ke as (select 1)`},
      ce as (
        insert into contracts.cks_certificates (id, tenant_id, customer_id, serial, serial_key, ca, device, holder_name,
          holder_title, keeper, valid_from, valid_to, source, lot_id, sale_contract_id, sale_price, status, created_by)
        select x.id, ${t}::uuid, ${cu.id}::uuid, x.serial, x.serial_key, x.ca, x.device, x.holder_name, x.holder_title,
          x.keeper, x.valid_from, x.valid_to, x.source, x.lot_id, x.sale_contract_id, x.sale_price, 'active', ${BY}
        from jsonb_to_recordset(${json(w.certs)}) as x (${CERT_COLS})),
      ${auditCte(t, withOrd(w.audit))}
      select 1`);
  };
  return { lock, saleCheck, insertLot, insertSale, ...renewalWrites(tx, t) };
}

const renewalJson = sql`jsonb_build_object('id', r.id, 'sale_contract_id', r.sale_contract_id, 'company_id', r.customer_id,
  'certificate_ids', to_jsonb(r.certificate_ids), 'status', r.status, 'new_contract_id', r.new_contract_id,
  'price_each', r.price_each, 'valid_to', r.valid_to, 'lost_reason', r.lost_reason, 'done_at', r.done_at)`;

function renewalWrites(tx: Tx, t: string) {
  const renewCheck: CksRepo["renewCheck"] = (saleId, year) =>
    one(
      tx,
      sql`select jsonb_build_object(
        'certs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'customer_id', c.customer_id, 'ca', c.ca,
            'valid_to', c.valid_to, 'sale_price', c.sale_price) order by c.valid_to, c.id)
          from contracts.cks_certificates c where c.tenant_id = ${t}::uuid and c.sale_contract_id = ${saleId}::uuid
            and c.status = 'active'), '[]'::jsonb),
        'open', exists (select 1 from contracts.cks_renewals r where r.tenant_id = ${t}::uuid
          and r.sale_contract_id = ${saleId}::uuid and r.status = 'open'),
        'buyer', (select k.fields -> 'buyer_name' ->> 'value' from contracts.contracts k
          where k.tenant_id = ${t}::uuid and k.id = ${saleId}::uuid),
        'buyer_tax', (select k.fields -> 'buyer_tax_id' ->> 'value' from contracts.contracts k
          where k.tenant_id = ${t}::uuid and k.id = ${saleId}::uuid),
        'numbers', coalesce((select jsonb_agg(k.number) from contracts.contracts k
          where k.tenant_id = ${t}::uuid and k.number like 'CKS-' || ${year}::text || '-%'), '[]'::jsonb)) as j`,
    );
  const insertRenewal: CksRepo["insertRenewal"] = async (w) => {
    const r = w.renewal;
    await tx.execute(sql`with ${contractCtes(t, w.contract)},
      re as (
        insert into contracts.cks_renewals (id, tenant_id, sale_contract_id, customer_id, certificate_ids, status,
          new_contract_id, price_each, valid_to, created_by)
        select ${r.id}::uuid, ${t}::uuid, ${r.sale_contract_id}::uuid, ${r.company_id}::uuid,
          (select array_agg(v::uuid) from jsonb_array_elements_text(${json(r.certificate_ids)}) v), 'open', k.id,
          ${r.price_each}::bigint, ${r.valid_to}::date, ${BY} from k
        returning id),
      up as (
        update contracts.cks_certificates c set status = 'pending_renewal'
        where c.tenant_id = ${t}::uuid and c.id in (select v::uuid from jsonb_array_elements_text(${json(r.certificate_ids)}) v)),
      fu as (
        insert into contracts.cks_followups (tenant_id, user_id, renewal_id, due_at)
        select ${t}::uuid, ${BY}, re.id, (${w.remindAt?.local ?? null}::timestamp at time zone ${w.remindAt?.tz ?? "UTC"}::text)
        from re where ${w.remindAt?.local ?? null}::text is not null),
      ${auditCte(t, withOrd(w.audit))}
      select 1`);
  };
  const renewal: CksRepo["renewal"] = (id) =>
    one(
      tx,
      sql`select (select ${renewalJson} || jsonb_build_object('old_price', (select c.sale_price
          from contracts.cks_certificates c where c.tenant_id = ${t}::uuid and c.id = r.certificate_ids[1]))
        from contracts.cks_renewals r where r.tenant_id = ${t}::uuid and r.id = ${id}::uuid) as j`,
    );
  const takenSerials: CksRepo["takenSerials"] = (keys) =>
    one(
      tx,
      sql`select coalesce(jsonb_agg(c.serial_key), '[]'::jsonb) as j from contracts.cks_certificates c
        where c.tenant_id = ${t}::uuid and c.serial_key in (select jsonb_array_elements_text(${json(keys)}))`,
    );
  return { renewCheck, insertRenewal, renewal, takenSerials, ...closeWrites(tx, t) };
}

function closeWrites(tx: Tx, t: string) {
  const completeRenewal: CksRepo["completeRenewal"] = (w) =>
    one<RenewalOut>(
      tx,
      sql`with r0 as (select * from contracts.cks_renewals where tenant_id = ${t}::uuid and id = ${w.id}::uuid),
      x as (select * from jsonb_to_recordset(${json(w.news)}) as x (old uuid, id uuid, serial text, serial_key text)),
      nc as (
        insert into contracts.cks_certificates (id, tenant_id, customer_id, serial, serial_key, ca, device, holder_name,
          holder_title, keeper, valid_from, valid_to, source, lot_id, sale_contract_id, sale_price, status, replaces,
          created_by)
        select x.id, ${t}::uuid, o.customer_id, x.serial, x.serial_key, o.ca, o.device, o.holder_name, o.holder_title,
          o.keeper, ${w.today}::date, ${w.valid_to}::date, o.source, o.lot_id, r0.new_contract_id, r0.price_each, 'active',
          o.id, ${BY}
        from x join contracts.cks_certificates o on o.id = x.old and o.tenant_id = ${t}::uuid cross join r0
        returning id, replaces),
      oc as (
        update contracts.cks_certificates o set status = 'replaced', replaced_by = nc.id
        from nc where o.tenant_id = ${t}::uuid and o.id = nc.replaces),
      fu as (
        update contracts.cks_followups f set done_at = now()
        where f.tenant_id = ${t}::uuid and f.renewal_id = ${w.id}::uuid and f.done_at is null),
      -- HD8-FR-07 (sales.py:130-132): mỗi chữ ký gia hạn ⇒ một dòng uy tín cks_renewed của khách (đối tác = party_key khách CKS).
      pe as (
        insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, contract_id, data)
        select ${t}::uuid, cu.party_key, 'customer', 'cks_renewed', ${w.today}::date, ${BY}, 'action', r0.new_contract_id,
          jsonb_build_object('certificate_id', o.id, 'days_before_expiry', o.valid_to - ${w.today}::date, 'with_us', true)
        from nc join contracts.cks_certificates o on o.id = nc.replaces and o.tenant_id = ${t}::uuid
          join contracts.cks_customers cu on cu.id = o.customer_id and cu.tenant_id = ${t}::uuid cross join r0
        where cu.party_key is not null),
      ${auditCte(t, withOrd(w.audit))},
      r as (
        update contracts.cks_renewals rr set status = 'done', done_at = ${w.today}::date
        where rr.tenant_id = ${t}::uuid and rr.id = ${w.id}::uuid and rr.status = 'open'
        returning rr.*)
      select ${renewalJson} as j from r`,
    );
  const loseRenewal: CksRepo["loseRenewal"] = (w) =>
    one<RenewalOut>(
      tx,
      sql`with r as (
        update contracts.cks_renewals rr set status = 'lost', lost_reason = ${w.reason}, done_at = ${w.today}::date
        where rr.tenant_id = ${t}::uuid and rr.id = ${w.id}::uuid and rr.status = 'open'
        returning rr.*),
      c as (
        update contracts.cks_certificates c set status = 'active'
        from r where c.tenant_id = ${t}::uuid and c.id = any (r.certificate_ids) and c.status = 'pending_renewal'),
      k as (
        update contracts.contracts k set status = 'terminated', updated_at = now(), version = k.version + 1,
          handled = jsonb_build_object('outcome', 'not_renewed', 'by', ${BY}::text, 'at', ${w.today}::text,
            'note', ${w.reason}::text)
        from r where k.tenant_id = ${t}::uuid and k.id = r.new_contract_id),
      ko as (
        -- HD7-FR-11 (sales.py:146-148): mất khách ⇒ đợt chưa xong của HĐ gia hạn không còn ai nợ (cancelled).
        update contracts.obligations o set status = 'cancelled', updated_at = now()
        from r where o.tenant_id = ${t}::uuid and o.contract_id = r.new_contract_id and o.status = 'open'),
      fu as (
        update contracts.cks_followups f set done_at = now()
        from r where f.tenant_id = ${t}::uuid and f.renewal_id = r.id and f.done_at is null),
      -- HD8-FR-07 (sales.py:145): mất khách ⇒ một dòng uy tín cks_lapsed gắn HĐ bán, lý do làm ghi chú.
      pl as (
        insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, contract_id, note)
        select ${t}::uuid, cu.party_key, 'customer', 'cks_lapsed', ${w.today}::date, ${BY}, 'action', r.sale_contract_id,
          nullif(left(${w.reason}::text, 500), '')
        from r join contracts.cks_customers cu on cu.id = r.customer_id and cu.tenant_id = ${t}::uuid
        where cu.party_key is not null)
      select ${renewalJson} as j from r`,
    );
  const insertFollowup: CksRepo["insertFollowup"] = (w) =>
    one(
      tx,
      sql`insert into contracts.cks_followups (tenant_id, user_id, customer_id, due_at, note)
        values (${t}::uuid, ${BY}, ${w.customer_id}::uuid, (${w.local}::timestamp at time zone ${w.tz}::text), ${w.note})
        returning to_jsonb(id) as j`,
    );
  const insertSignedDocs: CksRepo["insertSignedDocs"] = (rows) =>
    one(
      tx,
      sql`with x as (
        select * from jsonb_to_recordset(${json(rows)}) as x (sha256 text, serial_key text, kind text, number text,
          title text, signed_at date, period text, source text, filename text, unsigned boolean)),
      ins as (
        insert into contracts.cks_signed_docs (tenant_id, customer_id, certificate_id, serial_key, kind, number, title,
          signed_at, period, source, filename, sha256, unsigned, created_by)
        select ${t}::uuid, c.customer_id, c.id, x.serial_key, x.kind, x.number, x.title, x.signed_at, x.period, x.source,
          x.filename, x.sha256, x.unsigned, ${BY}
        from x left join contracts.cks_certificates c on c.tenant_id = ${t}::uuid and c.serial_key = x.serial_key
        on conflict do nothing
        returning certificate_id)
      select jsonb_build_object('added', count(*), 'unmatched', count(*) filter (where certificate_id is null)) as j
      from ins`,
    );
  return { completeRenewal, loseRenewal, insertFollowup, insertSignedDocs };
}
