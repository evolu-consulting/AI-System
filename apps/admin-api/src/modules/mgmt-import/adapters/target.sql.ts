// I1 · câu ghi theo tập của importer: MỖI bảng MỘT câu văn bản cố định, dữ liệu lô qua MỘT tham số JSON (Luật 4c), chạy trong tx
// `withPackScope` (role `<gói>_rw`, RLS FORCE theo tenant). Mọi câu `ON CONFLICT DO NOTHING` (chỉ cần quyền INSERT — bảng chỉ
// thêm vẫn ghi được) ⇒ chạy lại không nhân đôi. Bảng không có khoá tự nhiên (id bigint) ⇒ khoá idempotent qua `NOT EXISTS`.
// Cột tham chiếu theo khoá tự nhiên (loại hàng theo tên, khách CKS theo MST/tên, thực thể theo key) tra trong SQL ⇒ đúng cả khi
// hàng đích đã có sẵn với id khác.
import { type SQL, sql } from "drizzle-orm";
import type { TableName } from "../domain/plan";

type Q = (tid: string, json: string) => SQL;
const T = (tid: string) => sql`${tid}::uuid`;

/** Khách CKS theo khoá tự nhiên (MST, hoặc tên gấp khi không MST). */
const CUSTOMER = (
  tid: string,
) => sql`(select c.id from contracts.cks_customers c where c.tenant_id = ${T(tid)}
  and ((x.cust_tax is not null and c.tax_id = x.cust_tax)
    or (x.cust_tax is null and c.tax_id is null and c.name_key = contracts.fold(x.cust_name))) limit 1)`;
const ENTITY = (tid: string, col: SQL) =>
  sql`(select e.id from knowledge.entities e where e.tenant_id = ${T(tid)} and e.key = ${col})`;

export const INSERTS: Record<TableName, Q> = {
  "contracts.visibility_settings": (
    tid,
    j,
  ) => sql`insert into contracts.visibility_settings (tenant_id, mode)
    select ${T(tid)}, x.mode from jsonb_to_recordset(${j}::jsonb) as x(mode text) on conflict do nothing returning 1`,
  "contracts.contract_categories": (
    tid,
    j,
  ) => sql`insert into contracts.contract_categories (id, tenant_id, name)
    select x.id, ${T(tid)}, x.name from jsonb_to_recordset(${j}::jsonb) as x(id uuid, name text)
    on conflict do nothing returning 1`,
  "contracts.files": (
    tid,
    j,
  ) => sql`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime,
      size_bytes, created_by)
    select x.id, ${T(tid)}, x.org, x.file_id, x.version_id, x.name, x.mime, x.size_bytes, x.created_by
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, org text, file_id text, version_id text, name text, mime text,
      size_bytes bigint, created_by uuid)
    on conflict do nothing returning 1`,
  "contracts.contracts": (
    tid,
    j,
  ) => sql`insert into contracts.contracts (id, tenant_id, kind, parent_id, title, direction,
      status, error, owner_user_id, created_by, created_at, updated_at, confirmed_at, confirmed_by, fields, file_id,
      source_text, clauses, warnings, action_deadline, handled)
    select x.id, ${T(tid)}, x.kind, x.parent_id, x.title, x.direction, x.status, x.error, x.owner_user_id, x.created_by,
      coalesce(x.created_at, now()), coalesce(x.updated_at, now()), x.confirmed_at, x.confirmed_by, x.fields, x.file_id,
      x.source_text, x.clauses, x.warnings, x.action_deadline, x.handled
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, kind text, parent_id uuid, title text, direction text, status text,
      error text, owner_user_id uuid, created_by uuid, created_at timestamptz, updated_at timestamptz,
      confirmed_at timestamptz, confirmed_by uuid, fields jsonb, file_id uuid, source_text text, clauses jsonb,
      warnings jsonb, action_deadline date, handled jsonb)
    on conflict do nothing returning 1`,
  "contracts.contract_items": (
    tid,
    j,
  ) => sql`insert into contracts.contract_items (id, tenant_id, contract_id, ord, code,
      name, spec, unit, qty, unit_price, vat_rate, moq, lead_time_days, valid_from, valid_to, category_id, quote, verified,
      edited)
    select x.id, ${T(tid)}, x.contract_id, x.ord, x.code, x.name, x.spec, x.unit, x.qty, x.unit_price, x.vat_rate, x.moq,
      x.lead_time_days, x.valid_from, x.valid_to,
      (select c.id from contracts.contract_categories c where c.tenant_id = ${T(tid)} and lower(c.name) = lower(x.category_name)),
      x.quote, x.verified, x.edited
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, contract_id uuid, ord int, code text, name text, spec text,
      unit text, qty numeric, unit_price bigint, vat_rate numeric, moq numeric, lead_time_days int, valid_from date,
      valid_to date, category_name text, quote text, verified boolean, edited boolean)
    on conflict do nothing returning 1`,
  "contracts.contract_events": (
    tid,
    j,
  ) => sql`insert into contracts.contract_events (tenant_id, contract_id, type, at, data)
    select ${T(tid)}, x.contract_id, x.type, coalesce(x.at, now()), x.data
    from jsonb_to_recordset(${j}::jsonb) as x(contract_id uuid, type text, at timestamptz, data jsonb)
    where not exists (select 1 from contracts.contract_events e where e.tenant_id = ${T(tid)}
      and e.contract_id = x.contract_id and e.type = x.type)
    returning 1`,
  "contracts.contract_reminders": (
    tid,
    j,
  ) => sql`insert into contracts.contract_reminders (tenant_id, contract_id, deadline,
      milestone, user_id, channel, sent_at)
    select ${T(tid)}, x.contract_id, x.deadline, x.milestone, x.user_id, x.channel, coalesce(x.sent_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(contract_id uuid, deadline date, milestone int, user_id uuid, channel text,
      sent_at timestamptz)
    where exists (select 1 from contracts.contracts c where c.id = x.contract_id and c.tenant_id = ${T(tid)})
    on conflict do nothing returning 1`,
  "contracts.cks_customers": (
    tid,
    j,
  ) => sql`insert into contracts.cks_customers (id, tenant_id, name, tax_id)
    select x.id, ${T(tid)}, x.name, x.tax_id from jsonb_to_recordset(${j}::jsonb) as x(id uuid, name text, tax_id text)
    on conflict do nothing returning 1`,
  "contracts.cks_lots": (
    tid,
    j,
  ) => sql`insert into contracts.cks_lots (id, tenant_id, label, ca, qty, unit_cost, years,
      device, bought_at, purchase_contract_id, created_by, created_at)
    select x.id, ${T(tid)}, x.label, x.ca, x.qty, x.unit_cost, x.years, x.device, x.bought_at, x.purchase_contract_id,
      x.created_by, coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, label text, ca text, qty int, unit_cost bigint, years int,
      device text, bought_at date, purchase_contract_id uuid, created_by uuid, created_at timestamptz)
    on conflict do nothing returning 1`,
  "contracts.cks_certificates": (
    tid,
    j,
  ) => sql`insert into contracts.cks_certificates (id, tenant_id, customer_id, serial,
      serial_key, ca, device, holder_name, holder_title, keeper, valid_from, valid_to, source, lot_id, sale_contract_id,
      sale_price, status, replaces, replaced_by, created_by, created_at)
    select x.id, ${T(tid)}, ${CUSTOMER(tid)}, x.serial, x.serial_key, x.ca, x.device, x.holder_name, x.holder_title,
      x.keeper, x.valid_from, x.valid_to, x.source, x.lot_id, x.sale_contract_id, x.sale_price, x.status, x.replaces,
      x.replaced_by, x.created_by, coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, cust_name text, cust_tax text, serial text, serial_key text,
      ca text, device text, holder_name text, holder_title text, keeper text, valid_from date, valid_to date, source text,
      lot_id uuid, sale_contract_id uuid, sale_price bigint, status text, replaces uuid, replaced_by uuid, created_by uuid,
      created_at timestamptz)
    on conflict do nothing returning 1`,
  "contracts.cks_renewals": (
    tid,
    j,
  ) => sql`insert into contracts.cks_renewals (id, tenant_id, sale_contract_id, customer_id,
      certificate_ids, status, new_contract_id, price_each, valid_to, lost_reason, created_by, created_at, done_at)
    select x.id, ${T(tid)}, x.sale_contract_id, ${CUSTOMER(tid)}, x.certificate_ids, x.status, x.new_contract_id,
      x.price_each, x.valid_to, x.lost_reason, x.created_by, coalesce(x.created_at, now()), x.done_at
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, sale_contract_id uuid, cust_name text, cust_tax text,
      certificate_ids uuid[], status text, new_contract_id uuid, price_each bigint, valid_to date, lost_reason text,
      created_by uuid, created_at timestamptz, done_at date)
    on conflict do nothing returning 1`,
  "contracts.cks_followups": (
    tid,
    j,
  ) => sql`insert into contracts.cks_followups (id, tenant_id, user_id, customer_id,
      renewal_id, due_at, note, created_at, done_at)
    select x.id, ${T(tid)}, x.user_id, case when x.renewal_id is null then ${CUSTOMER(tid)} end, x.renewal_id, x.due_at,
      x.note, coalesce(x.created_at, now()), x.done_at
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, user_id uuid, cust_name text, cust_tax text, renewal_id uuid,
      due_at timestamptz, note text, created_at timestamptz, done_at timestamptz)
    on conflict do nothing returning 1`,
  "contracts.cks_signed_docs": (
    tid,
    j,
  ) => sql`insert into contracts.cks_signed_docs (id, tenant_id, customer_id,
      certificate_id, serial_key, kind, number, title, signed_at, period, source, filename, sha256, unsigned, created_by,
      created_at)
    select x.id, ${T(tid)}, case when x.cust_name is not null or x.cust_tax is not null then ${CUSTOMER(tid)} end,
      x.certificate_id, x.serial_key, x.kind, x.number, x.title, x.signed_at, x.period, x.source, x.filename, x.sha256,
      x.unsigned, x.created_by, coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, cust_name text, cust_tax text, certificate_id uuid, serial_key text,
      kind text, number text, title text, signed_at date, period text, source text, filename text, sha256 text,
      unsigned boolean, created_by uuid, created_at timestamptz)
    on conflict do nothing returning 1`,
  "contracts.cks_market_prices": (
    tid,
    j,
  ) => sql`insert into contracts.cks_market_prices (id, tenant_id, ca_key, ca_name,
      years, kind, device, seller, tier, price_ex_vat, url, verified, seen)
    select x.id, ${T(tid)}, x.ca_key, x.ca_name, x.years, x.kind, x.device, x.seller, x.tier, x.price_ex_vat, x.url,
      x.verified, x.seen
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, ca_key text, ca_name text, years int, kind text, device text,
      seller text, tier text, price_ex_vat bigint, url text, verified boolean, seen date)
    on conflict do nothing returning 1`,
  "contracts.obligations": (
    tid,
    j,
  ) => sql`insert into contracts.obligations (id, tenant_id, contract_id, party_key, direction,
      kind, seq, due_date, amount, status, done_at, done_by, postponed_to, postpones, reminders, overdue_for, source,
      estimated, basis, created_at, updated_at)
    select x.id, ${T(tid)}, x.contract_id, contracts.party_key(x.party_name, x.party_tax), x.direction, x.kind, x.seq,
      x.due_date, x.amount, x.status, x.done_at, x.done_by, x.postponed_to, x.postpones, x.reminders, x.overdue_for,
      x.source, x.estimated, x.basis, coalesce(x.created_at, now()), coalesce(x.updated_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, contract_id uuid, party_name text, party_tax text, direction text,
      kind text, seq int, due_date date, amount bigint, status text, done_at date, done_by uuid, postponed_to date,
      postpones int, reminders int, overdue_for date, source text, estimated boolean, basis text, created_at timestamptz,
      updated_at timestamptz)
    on conflict do nothing returning 1`,
  "contracts.partner_events": (
    tid,
    j,
  ) => sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at,
      by_user, source, contract_id, obligation_id, days_late, amount, note, data, created_at)
    select ${T(tid)}, contracts.party_key(x.party_name, x.party_tax), x.role, x.type, x.at, x.by_user, x.source,
      x.contract_id, x.obligation_id, x.days_late, x.amount, x.note, x.data, coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(mgmt_id text, party_name text, party_tax text, role text, type text,
      at date, by_user uuid, source text, contract_id uuid, obligation_id uuid, days_late int, amount bigint, note text,
      data jsonb, created_at timestamptz)
    where not exists (select 1 from contracts.partner_events e where e.tenant_id = ${T(tid)}
      and e.data->>'mgmt_id' = x.mgmt_id and e.data->>'mgmt_source' = x.data->>'mgmt_source')
    returning 1`,
  "contracts.partner_event_voids": (
    tid,
    j,
  ) => sql`insert into contracts.partner_event_voids (event_id, tenant_id, by_user, at)
    select e.id, ${T(tid)}, x.by_user, coalesce(x.at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(mgmt_id text, by_user uuid, at timestamptz)
    join contracts.partner_events e on e.tenant_id = ${T(tid)} and e.data->>'mgmt_id' = x.mgmt_id
    on conflict do nothing returning 1`,
  "contracts.legacy_records": (
    tid,
    j,
  ) => sql`insert into contracts.legacy_records (tenant_id, kind, mgmt_id, doc)
    select ${T(tid)}, x.kind, x.mgmt_id, x.doc from jsonb_to_recordset(${j}::jsonb) as x(kind text, mgmt_id text, doc jsonb)
    on conflict do nothing returning 1`,
  "knowledge.documents": (
    tid,
    j,
  ) => sql`insert into knowledge.documents (id, tenant_id, title, kind, source, uri,
      content_hash, chunk_count, created_at)
    select x.id, ${T(tid)}, x.title, x.kind, x.source, x.uri, x.content_hash, x.chunk_count, coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, title text, kind text, source text, uri text, content_hash text,
      chunk_count int, created_at timestamptz)
    on conflict do nothing returning 1`,
  "knowledge.chunks": (
    tid,
    j,
  ) => sql`insert into knowledge.chunks (id, tenant_id, doc_id, ord, heading, clause_no, context, body)
    select x.id, ${T(tid)}, x.doc_id, x.ord, x.heading, x.clause_no, x.context, x.body
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, doc_id uuid, ord int, heading text, clause_no text, context text,
      body text)
    where exists (select 1 from knowledge.documents d where d.id = x.doc_id and d.tenant_id = ${T(tid)})
    on conflict do nothing returning 1`,
  "knowledge.entities": (tid, j) => sql`insert into knowledge.entities (tenant_id, key, name, type)
    select ${T(tid)}, x.key, x.name, x.type from jsonb_to_recordset(${j}::jsonb) as x(key text, name text, type text)
    on conflict do nothing returning 1`,
  "knowledge.chunk_entities": (
    tid,
    j,
  ) => sql`insert into knowledge.chunk_entities (tenant_id, chunk_id, entity_id)
    select ${T(tid)}, x.chunk_id, e.id from jsonb_to_recordset(${j}::jsonb) as x(chunk_id uuid, key text)
    join knowledge.entities e on e.tenant_id = ${T(tid)} and e.key = x.key
    where exists (select 1 from knowledge.chunks c where c.id = x.chunk_id and c.tenant_id = ${T(tid)})
    on conflict do nothing returning 1`,
  "knowledge.entity_aliases": (
    tid,
    j,
  ) => sql`insert into knowledge.entity_aliases (tenant_id, a_id, b_id)
    select ${T(tid)}, least(a.id, b.id), greatest(a.id, b.id) from jsonb_to_recordset(${j}::jsonb) as x(a text, b text)
    join knowledge.entities a on a.tenant_id = ${T(tid)} and a.key = x.a
    join knowledge.entities b on b.tenant_id = ${T(tid)} and b.key = x.b
    where a.id <> b.id on conflict do nothing returning 1`,
  "knowledge.entity_rels": (
    tid,
    j,
  ) => sql`insert into knowledge.entity_rels (tenant_id, src_id, dst_id, type, evidence_chunk_id)
    select ${T(tid)}, ${ENTITY(tid, sql`x.src`)}, ${ENTITY(tid, sql`x.dst`)}, x.type,
      (select c.id from knowledge.chunks c where c.id = x.evidence and c.tenant_id = ${T(tid)})
    from jsonb_to_recordset(${j}::jsonb) as x(src text, dst text, type text, evidence uuid)
    where ${ENTITY(tid, sql`x.src`)} is not null and ${ENTITY(tid, sql`x.dst`)} is not null
    on conflict do nothing returning 1`,
  "knowledge.chunk_links": (
    tid,
    j,
  ) => sql`insert into knowledge.chunk_links (tenant_id, src_id, dst_id, kind, score, reason,
      src_doc_id, dst_doc_id)
    select ${T(tid)}, x.src_id, x.dst_id, x.kind, x.score, x.reason, a.doc_id, b.doc_id
    from jsonb_to_recordset(${j}::jsonb) as x(src_id uuid, dst_id uuid, kind text, score real, reason text)
    join knowledge.chunks a on a.id = x.src_id and a.tenant_id = ${T(tid)}
    join knowledge.chunks b on b.id = x.dst_id and b.tenant_id = ${T(tid)}
    on conflict do nothing returning 1`,
  "knowledge.document_links": (
    tid,
    j,
  ) => sql`insert into knowledge.document_links (tenant_id, src_id, dst_id)
    select ${T(tid)}, x.src_id, x.dst_id from jsonb_to_recordset(${j}::jsonb) as x(src_id uuid, dst_id uuid)
    where exists (select 1 from knowledge.documents d where d.id = x.src_id and d.tenant_id = ${T(tid)})
      and exists (select 1 from knowledge.documents d where d.id = x.dst_id and d.tenant_id = ${T(tid)})
    on conflict do nothing returning 1`,
};

/** Gói (role `<k>_rw`) của bảng. */
export const packOf = (t: TableName): "contracts" | "knowledge" =>
  t.startsWith("knowledge.") ? "knowledge" : "contracts";
