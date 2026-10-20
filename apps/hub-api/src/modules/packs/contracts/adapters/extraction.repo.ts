// HD-FR-21 · HD-FR-24 · HD-FR-26 · HD2 plan "Thiết kế hiệu năng" (Luật 4c): SQL trích/nhập tay trong tx `PackUow` (role
// `contracts_rw`, RLS FORCE) + `tenant_id` tường minh trong mọi WHERE. Mỗi hàm MỘT câu văn bản HẰNG; dòng hàng đi theo lô
// qua MỘT tham số JSON (`jsonb_to_recordset`) — số câu không phụ thuộc số dòng.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ExtractionRepo,
  ExtractionSource,
  RequestExtractOutcome,
} from "../application/extraction.ports";

const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type SourceRow = {
  status: string;
  version: number;
  items: unknown;
  kind: "contract" | "appendix";
  text: string | null;
  fields: unknown;
  org: string | null;
  file_id: string | null;
  mime: string | null;
  p_fields: unknown;
  p_items: unknown;
};

function toSource(r: SourceRow): ExtractionSource {
  const pItems = (json(r.p_items) ?? []) as {
    code: string | null;
    name: string;
    unit: string | null;
    unit_price: number | string | null;
  }[];
  const items = (json(r.items) ?? []) as { qty: unknown; unit_price: unknown }[];
  return {
    status: r.status,
    version: r.version,
    items: items.map((i) => ({ qty: num(i.qty), unit_price: num(i.unit_price) })),
    kind: r.kind,
    text: r.text,
    fields: json(r.fields),
    file: r.org && r.file_id && r.mime ? { org: r.org, fileId: r.file_id, mime: r.mime } : null,
    parent:
      r.kind === "appendix" && r.p_fields
        ? {
            fields: json(r.p_fields) as Record<string, { value: unknown }>,
            items: pItems.map((i) => ({ ...i, unit_price: num(i.unit_price) })),
          }
        : null,
  };
}

const ITEMS_JSON = sql`(code text, name text, spec text, unit text, qty numeric, unit_price bigint, vat_rate numeric,
  moq numeric, lead_time_days int, valid_from date, valid_to date, quote text, verified boolean, ord int)`;

function sourceQ(tx: Tx, tenantId: string): ExtractionRepo["source"] {
  return async (id) => {
    const rows =
      await tx.execute<SourceRow>(sql`select c.status, c.version, c.kind, c.source_text as text, c.fields,
        (select coalesce(jsonb_agg(jsonb_build_object('qty', i.qty, 'unit_price', i.unit_price)), '[]'::jsonb)
          from contracts.contract_items i where i.contract_id = c.id and i.tenant_id = ${tenantId}::uuid) as items,
        f.org, f.file_id, f.mime, p.fields as p_fields,
        (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name, 'unit', i.unit,
            'unit_price', i.unit_price) order by i.ord), '[]'::jsonb)
          from contracts.contract_items i where i.contract_id = p.id and i.tenant_id = ${tenantId}::uuid) as p_items
      from contracts.contracts c
      left join contracts.files f on f.id = c.file_id and f.tenant_id = ${tenantId}::uuid
      left join contracts.contracts p on p.id = c.parent_id and p.tenant_id = ${tenantId}::uuid
      where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid`);
    const r = rows[0];
    return r ? toSource(r) : null;
  };
}

function saveResultQ(tx: Tx, tenantId: string): ExtractionRepo["saveResult"] {
  return async (id, res) => {
    const items = res.items ?? [];
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts set fields = ${JSON.stringify(res.fields)}::jsonb,
          clauses = ${JSON.stringify(res.clauses)}::jsonb, warnings = ${JSON.stringify(res.warnings)}::jsonb,
          status = 'needs_review', error = null, version = version + 1, updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and status = 'extracting'
          and version = ${res.expected}::int
        returning id),
      i as (
        insert into contracts.contract_items (tenant_id, contract_id, ord, code, name, spec, unit, qty, unit_price,
          vat_rate, moq, lead_time_days, valid_from, valid_to, quote, verified, edited)
        select ${tenantId}::uuid, u.id, x.ord, x.code, x.name, x.spec, x.unit, x.qty, x.unit_price, x.vat_rate, x.moq,
          x.lead_time_days, x.valid_from, x.valid_to, nullif(x.quote, ''), x.verified, false
        from u, jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as x ${ITEMS_JSON}),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, data)
        select ${tenantId}::uuid, u.id, 'extracted',
          jsonb_build_object('items', ${items.length}::int, 'warnings', ${res.warnings.length}::int) from u)
      select id from u`);
    return rows.length > 0;
  };
}

function saveWarningsQ(tx: Tx, tenantId: string): ExtractionRepo["saveWarnings"] {
  return async (id, warnings, expected) => {
    const rows = await tx.execute<{ id: string }>(sql`update contracts.contracts
      set warnings = ${JSON.stringify(warnings)}::jsonb
      where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and status = 'needs_review'
        and version = ${expected}::int
      returning id`);
    return rows.length > 0;
  };
}

function saveFailureQ(tx: Tx, tenantId: string): ExtractionRepo["saveFailure"] {
  return async (id, code) => {
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts set status = 'extract_failed', error = ${code}, version = version + 1,
          updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and status = 'extracting' returning id),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, data)
        select ${tenantId}::uuid, u.id, 'extract_failed', jsonb_build_object('code', ${code}::text) from u)
      select id from u`);
    return rows.length > 0;
  };
}

function requestExtractQ(tx: Tx, tenantId: string): ExtractionRepo["requestExtract"] {
  return async (id, actor): Promise<RequestExtractOutcome> => {
    const rows = await tx.execute<{
      status: string;
      has_src: boolean;
      version: number | null;
    }>(sql`with c as (
        select id, status, (source_text is not null or file_id is not null) as has_src
        from contracts.contracts where id = ${id}::uuid and tenant_id = ${tenantId}::uuid for update),
      u as (
        update contracts.contracts t set status = 'extracting', error = null, version = t.version + 1,
          updated_at = now()
        from c where t.id = c.id and t.tenant_id = ${tenantId}::uuid and c.has_src
          and c.status in ('needs_review', 'extract_failed')
        returning t.id, t.version),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tenantId}::uuid, u.id, 'extract_requested', ${actor}::uuid, '{}'::jsonb from u)
      select c.status, c.has_src, u.version from c left join u on u.id = c.id`);
    const r = rows[0];
    if (!r) return { kind: "not_found" };
    if (r.version !== null) return { kind: "ok", version: r.version };
    if (r.status === "extracting") return { kind: "busy" };
    // Đã duyệt/đang theo dõi (HD3+): không trích lại (review Thấp 7).
    if (r.status !== "needs_review" && r.status !== "extract_failed")
      return { kind: "not_allowed" };
    return { kind: "no_source" };
  };
}

function insertManualQ(tx: Tx, tenantId: string): ExtractionRepo["insertManual"] {
  return async (m) => {
    const items = m.items;
    // V2-A · C3: cờ duyệt đọc TRONG câu (`approval_on()`, RLS tenant) ⇒ tắt duyệt: HĐ `active` + mốc mặc định cùng câu.
    const rows = await tx.execute<{
      id: string;
      version: number;
      status: "needs_review" | "active";
    }>(sql`with s as (select contracts.approval_on() as on),
      c as (
        insert into contracts.contracts (id, tenant_id, kind, title, direction, deal, commission_pct, commission_fixed,
          status, owner_user_id, created_by, fields, warnings, confirmed_at, confirmed_by)
        select ${m.id}::uuid, ${tenantId}::uuid, 'contract', ${m.title}, ${m.direction}, ${m.deal},
          ${m.commissionPct}::numeric, ${m.commissionFixed}::bigint,
          case when s.on then 'needs_review' else 'active' end,
          ${m.userId}::uuid, ${m.userId}::uuid, ${JSON.stringify(m.fields)}::jsonb, ${JSON.stringify(m.warnings)}::jsonb,
          case when s.on then null else now() end, case when s.on then null else ${m.userId}::uuid end
        from s
        returning id, version, status, direction, fields),
      ms as (
        insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, title, owner,
          source)
        select ${tenantId}::uuid, c.id, contracts.party_key(
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value'),
          x.direction, x.kind, x.ord, x.due_date, x.title, x.owner, 'default'
        from c, jsonb_to_recordset(${JSON.stringify(m.milestones.map((x, ord) => ({ ...x, ord: ord + 1 })))}::jsonb)
          as x (ord int, kind text, direction text, due_date date, title text, owner text)
        where c.status = 'active'),
      i as (
        insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited)
        select ${tenantId}::uuid, c.id, x.ord, x.name, x.unit, x.qty, x.unit_price, true, true
        from c, jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
          as x (ord int, name text, unit text, qty numeric, unit_price bigint)),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tenantId}::uuid, c.id, 'created_manual', ${m.userId}::uuid,
          jsonb_build_object('items', ${items.length}::int, 'deal', ${m.deal}::text, 'status', c.status) from c)
      select id, version, status from c`);
    const r = rows[0];
    if (!r) throw new Error("insert-manual: no row");
    return { id: r.id, version: r.version, status: r.status };
  };
}

export function extractionRepo(tx: Tx, tenantId: string): ExtractionRepo {
  return {
    source: sourceQ(tx, tenantId),
    saveResult: saveResultQ(tx, tenantId),
    saveWarnings: saveWarningsQ(tx, tenantId),
    saveFailure: saveFailureQ(tx, tenantId),
    requestExtract: requestExtractQ(tx, tenantId),
    insertManual: insertManualQ(tx, tenantId),
  };
}
