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
import { initialState } from "../domain/contract-state.rules";
import { contractStateRepo, refreshEffect } from "./contract-state.repo";

const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type SourceRow = {
  status: string;
  extract_state: string;
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
  version_no: number | null;
  root_number: string | null;
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
    extractState: r.extract_state,
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
    chain:
      r.version_no !== null && r.version_no > 1
        ? { versionNo: r.version_no, rootNumber: r.root_number }
        : null,
  };
}

const ITEMS_JSON = sql`(code text, name text, spec text, unit text, qty numeric, unit_price bigint, vat_rate numeric,
  moq numeric, lead_time_days int, valid_from date, valid_to date, quote text, verified boolean, ord int)`;

function sourceQ(tx: Tx, tenantId: string): ExtractionRepo["source"] {
  return async (id) => {
    const rows =
      await tx.execute<SourceRow>(sql`select c.status, c.extract_state, c.version, c.kind, c.source_text as text, c.fields,
        (select coalesce(jsonb_agg(jsonb_build_object('qty', i.qty, 'unit_price', i.unit_price)), '[]'::jsonb)
          from contracts.contract_items i where i.contract_id = c.id and i.tenant_id = ${tenantId}::uuid) as items,
        f.org, f.file_id, f.mime, p.fields as p_fields,
        (select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name, 'unit', i.unit,
            'unit_price', i.unit_price) order by i.ord), '[]'::jsonb)
          from contracts.contract_items i where i.contract_id = p.id and i.tenant_id = ${tenantId}::uuid) as p_items,
        c.version_no, (select g.number from contracts.contracts g where g.id = c.root_id and g.tenant_id = ${tenantId}::uuid
          and c.version_no > 1) as root_number
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
    const aiJson = res.ai ? JSON.stringify(res.ai) : null;
    const terms = res.penaltyTerms ?? null; // K7 · null ⇒ bản trích cũ: không đụng penalty_terms
    // V2-G: loại HĐ AI đoán chỉ điền khi HĐ chưa có loại (người đã chọn/lưu thì giữ); Giới thiệu = tiền vào ⇒ hướng "sale".
    const aiDeal = res.ai?.deal ?? null;
    const rows = await tx.execute<{ id: string }>(sql`with u as (
        update contracts.contracts set fields = ${JSON.stringify(res.fields)}::jsonb,
          clauses = ${JSON.stringify(res.clauses)}::jsonb, warnings = ${JSON.stringify(res.warnings)}::jsonb,
          ai_read = coalesce(${aiJson}::jsonb, ai_read),
          deal = coalesce(deal, ${aiDeal}::text),
          direction = coalesce(direction, case ${aiDeal}::text when 'buy' then 'purchase' when 'sell' then 'sale'
            when 'referral' then 'sale' end),
          error = null, updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and status = 'draft' and extract_state = 'reading'
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
          jsonb_build_object('items', ${items.length}::int, 'warnings', ${res.warnings.length}::int) from u),
      pd as (delete from contracts.penalty_terms p using u
        where ${terms !== null}::boolean and p.contract_id = u.id and p.tenant_id = ${tenantId}::uuid and p.source = 'ai'),
      pi as (
        insert into contracts.penalty_terms (tenant_id, contract_id, party, trigger, rate_pct, basis, cap_pct, cap_amount,
          clause_ref, page, quote, source)
        select ${tenantId}::uuid, u.id, x.party, x.trigger, x.rate_pct, x.basis, x.cap_pct, x.cap_amount, x.clause_ref,
          x.page, nullif(x.quote, ''), 'ai'
        from u, jsonb_to_recordset(${JSON.stringify(terms ?? [])}::jsonb) as x (party text, trigger text, rate_pct numeric,
          basis text, cap_pct numeric, cap_amount bigint, clause_ref text, page int, quote text))
      select id from u`);
    if (rows.length === 0) return false;
    // CR-127 K1b · `extract_state` reading → ready + version+1 + event `status_changed` qua CỔNG (draft → draft, ev `extracted`).
    const g = await contractStateRepo(tx, tenantId).applyTransition({
      contractId: id,
      ev: "extracted",
      actorId: null,
    });
    return g.ok;
  };
}

function saveWarningsQ(tx: Tx, tenantId: string): ExtractionRepo["saveWarnings"] {
  return async (id, warnings, expected) => {
    const rows = await tx.execute<{ id: string }>(sql`update contracts.contracts
      set warnings = ${JSON.stringify(warnings)}::jsonb
      where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and status in ('draft', 'processing')
        and extract_state = 'ready' and version = ${expected}::int
      returning id`);
    return rows.length > 0;
  };
}

function saveFailureQ(tx: Tx, tenantId: string): ExtractionRepo["saveFailure"] {
  return async (id, code) => {
    // CR-127 K1b · CỔNG `extract_failed` (draft → draft, `extract_state = failed`), CAS còn `reading`; rồi ghi mã lỗi + event.
    const g = await contractStateRepo(tx, tenantId).applyTransition({
      contractId: id,
      ev: "extract_failed",
      actorId: null,
      reason: code,
      extra: sql`c.extract_state = 'reading'`,
    });
    if (!g.ok) return false;
    await tx.execute(sql`with u as (update contracts.contracts set error = ${code}
        where id = ${id}::uuid and tenant_id = ${tenantId}::uuid)
      insert into contracts.contract_events (tenant_id, contract_id, type, data)
      values (${tenantId}::uuid, ${id}::uuid, 'extract_failed', jsonb_build_object('code', ${code}::text))`);
    return true;
  };
}

function requestExtractQ(tx: Tx, tenantId: string): ExtractionRepo["requestExtract"] {
  return async (id, actor): Promise<RequestExtractOutcome> => {
    // CR-127 K1b · HĐ vẫn `draft`: chỉ `extract_state` ready|failed → reading (không đổi status ⇒ không qua cổng).
    const rows = await tx.execute<{
      status: string;
      extract_state: string;
      has_src: boolean;
      version: number | null;
    }>(sql`with c as (
        select id, status, extract_state, (source_text is not null or file_id is not null) as has_src
        from contracts.contracts where id = ${id}::uuid and tenant_id = ${tenantId}::uuid for update),
      u as (
        update contracts.contracts t set extract_state = 'reading', error = null, version = t.version + 1,
          updated_at = now()
        from c where t.id = c.id and t.tenant_id = ${tenantId}::uuid and c.has_src
          and c.status = 'draft' and c.extract_state in ('ready', 'failed')
        returning t.id, t.version),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tenantId}::uuid, u.id, 'extract_requested', ${actor}::uuid, '{}'::jsonb from u)
      select c.status, c.extract_state, c.has_src, u.version from c left join u on u.id = c.id`);
    const r = rows[0];
    if (!r) return { kind: "not_found" };
    if (r.version !== null) return { kind: "ok", version: r.version };
    if (r.status === "draft" && r.extract_state === "reading") return { kind: "busy" };
    // Đang duyệt/đã xong/bị từ chối: không trích lại (review Thấp 7).
    if (r.status !== "draft") return { kind: "not_allowed" };
    return { kind: "no_source" };
  };
}

function insertManualQ(tx: Tx, tenantId: string): ExtractionRepo["insertManual"] {
  return async (m) => {
    const items = m.items;
    // CR-127 K1b · R#2: nhập tay / giao dịch (`initialState`) vào DONE NGAY (`created_done`), có mốc mặc định, không qua duyệt; `effect`
    // tính sau INSERT bằng `refresh_effect` (một câu). CR-101 DOC-deals: giao dịch = `doc_type = 'deal'` + nguồn.
    const src = m.deal_doc?.source ?? null;
    const init = initialState(src ? "deal" : "create_manual");
    const rows = await tx.execute<{
      id: string;
      version: number;
      status: "done";
    }>(sql`with c as (
        insert into contracts.contracts (id, tenant_id, kind, doc_type, source, title, direction, deal, commission_pct,
          commission_fixed, status, extract_state, owner_user_id, created_by, fields, warnings, confirmed_at, confirmed_by)
        values (${m.id}::uuid, ${tenantId}::uuid, 'contract',
          case when ${src}::text is null then 'contract' else 'deal' end, ${src}::text, ${m.title}, ${m.direction}, ${m.deal},
          ${m.commissionPct}::numeric, ${m.commissionFixed}::bigint, ${init.status}, ${init.extractState},
          ${m.userId}::uuid, ${m.userId}::uuid, ${JSON.stringify(m.fields)}::jsonb, ${JSON.stringify(m.warnings)}::jsonb,
          now(), ${m.userId}::uuid)
        returning id, version, status, direction, fields),
      ms as (
        insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, title, owner,
          source)
        select ${tenantId}::uuid, c.id, contracts.party_key(
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value'),
          x.direction, x.kind, x.ord, x.due_date, x.title, x.owner, 'default'
        from c, jsonb_to_recordset(${JSON.stringify(m.milestones.map((x, ord) => ({ ...x, ord: ord + 1 })))}::jsonb)
          as x (ord int, kind text, direction text, due_date date, title text, owner text)),
      i as (
        insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited,
          product_id, component_ids)
        select ${tenantId}::uuid, c.id, x.ord, x.name, x.unit, x.qty, x.unit_price, true, true, x.product_id,
          (select array_agg(e::uuid) from jsonb_array_elements_text(x.component_ids) e)
        from c, jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
          as x (ord int, name text, unit text, qty numeric, unit_price bigint, product_id uuid, component_ids jsonb)),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tenantId}::uuid, c.id, case when ${src}::text is null then 'created_manual' else 'created_deal' end,
          ${m.userId}::uuid, jsonb_build_object('items', ${items.length}::int, 'deal', ${m.deal}::text, 'status', c.status,
            'source', ${src}::text) from c)
      select id, version, status from c`);
    const r = rows[0];
    if (!r) throw new Error("insert-manual: no row");
    if (init.sideEffects.includes("refresh_effect")) await refreshEffect(tx, [r.id]);
    return { id: r.id, version: r.version, status: r.status };
  };
}

export function extractionRepo(tx: Tx, tenantId: string): ExtractionRepo {
  return {
    source: sourceQ(tx, tenantId),
    saveResult: saveResultQ(tx, tenantId),
    saveWarnings: saveWarningsQ(tx, tenantId),
    ownParties: async () => {
      const [r] = await tx.execute<{
        n: string[] | null;
        t: string[] | null;
      }>(sql`select own_names as n, own_tax_ids as t
        from contracts.company_settings where tenant_id = ${tenantId}::uuid`);
      return { names: r?.n ?? [], taxIds: r?.t ?? [] };
    },
    saveFailure: saveFailureQ(tx, tenantId),
    requestExtract: requestExtractQ(tx, tenantId),
    insertManual: insertManualQ(tx, tenantId),
  };
}
