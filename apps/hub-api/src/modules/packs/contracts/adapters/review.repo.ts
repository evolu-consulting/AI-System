// V2-G · HD-02/HD-08 · §4.2 · C3 · C12 · Luật 4c: SQL của "Lưu" màn xác nhận + gắn lại SP cho dòng HĐ đã lưu. Tx do `PackUow` mở
// (role `contracts_rw`, RLS FORCE); `tenant_id` tường minh ngoài RLS. Lưu = 3 câu văn bản HẰNG (không phụ thuộc số dòng/mốc, dữ liệu
// lô qua MỘT tham số JSON mỗi loại): ① HĐ (trường, loại, hướng, hoa hồng) ② dòng hàng + mốc (một CTE; đọc HĐ đã cập nhật nên đối tác
// đúng phía) ③ xác nhận (`active` + lượt duyệt `done` khi tenant tắt duyệt) + event. Tách ③ khỏi ② vì trigger HD7 (đổi trạng thái ⇒
// đợt mặc định) phải THẤY mốc vừa ghi — CTE cùng câu không thấy nhau.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  AttachOutcome,
  ReviewItemWrite,
  ReviewLocked,
  ReviewRepo,
  ReviewSaveOutcome,
  ReviewWrite,
} from "../application/review.ports";
import { pgTextArray } from "./contracts.repo";

type LockRow = {
  version: number;
  updated_at: string | Date;
  status: string;
  deal: ReviewLocked["deal"];
  fields: unknown;
  approval: boolean;
  commission_pct: number | string | null;
  commission_fixed: number | string | null;
};
const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

const itemsJson = (items: readonly ReviewItemWrite[]) =>
  JSON.stringify(items.map((it, ord) => ({ ...it, ord })));

function lockQ(tx: Tx, t: string): ReviewRepo["lock"] {
  return async (id) => {
    const rows =
      await tx.execute<LockRow>(sql`select c.version, c.updated_at, c.status, c.deal, c.fields,
        contracts.approval_on() as approval, c.commission_pct, c.commission_fixed
      from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid for update`);
    const r = rows[0];
    if (!r) return null;
    return {
      version: r.version,
      updated_at: new Date(r.updated_at).toISOString(),
      status: r.status,
      deal: r.deal,
      fields: json(r.fields),
      approvalOn: r.approval,
      commissionPct: num(r.commission_pct),
      commissionFixed: num(r.commission_fixed),
    };
  };
}

/** ② Dòng hàng (sửa theo `id` / thêm mới) + bộ mốc (thay mốc AI/mặc định còn mở). Đếm để use case kiểm. */
async function itemsAndMilestones(tx: Tx, t: string, id: string, w: ReviewWrite) {
  const rows = await tx.execute<{
    bad: number;
    unk: number;
    upd: number;
    ins: number;
    ms: number;
  }>(sql`with ${itemCtes(t, id, w)}, ${milestoneCtes(t, id, w)}
    select (select n from bad) as bad, (select n from unk) as unk, (select count(*)::int from up) as upd,
      (select count(*)::int from ins) as ins, (select count(*)::int from mi) as ms`);
  const r = rows[0];
  if (!r) throw new Error("review-save: no row");
  return r;
}

/** CTE `k` (HĐ + đối tác + đỉnh seq/ord) … `ins` của ②. */
function itemCtes(t: string, id: string, w: ReviewWrite) {
  return sql`k as (
      select c.id,
        contracts.party_key(
          c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
          c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value') as party,
        (select coalesce(max(o.seq), 0) from contracts.obligations o
          where o.tenant_id = ${t}::uuid and o.contract_id = c.id) as top,
        (select coalesce(max(i.ord), -1) from contracts.contract_items i
          where i.tenant_id = ${t}::uuid and i.contract_id = c.id) as top_ord
      from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid),
    x as (select * from jsonb_to_recordset(${itemsJson(w.items ?? [])}::jsonb) as x (id uuid, ord int, name text, unit text,
      qty numeric, unit_price bigint, product_id uuid, component_ids jsonb) where ${w.items !== null}::boolean),
    comp as (select x.*, case when jsonb_typeof(x.component_ids) = 'array' then
        (select array_agg(e::uuid) from jsonb_array_elements_text(x.component_ids) e) end as comps from x),
    bad as (select count(*)::int as n from comp where comp.comps is not null and (comp.product_id is null or exists (
      select 1 from unnest(comp.comps) e where not exists (select 1 from contracts.product_components pc
        where pc.id = e and pc.product_id = comp.product_id and pc.tenant_id = ${t}::uuid)))),
    unk as (select count(*)::int as n from comp where comp.id is not null and not exists (
      select 1 from contracts.contract_items i where i.id = comp.id and i.contract_id = ${id}::uuid
        and i.tenant_id = ${t}::uuid)),
    up as (
      update contracts.contract_items i set name = comp.name, unit = comp.unit, qty = comp.qty, unit_price = comp.unit_price,
        product_id = comp.product_id, component_ids = comp.comps,
        edited = i.edited or (i.name, i.unit, i.qty, i.unit_price) is distinct from (comp.name, comp.unit, comp.qty, comp.unit_price)
      from comp where comp.id = i.id and i.contract_id = ${id}::uuid and i.tenant_id = ${t}::uuid
        and (select n from bad) = 0
      returning i.id),
    ins as (
      insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited,
        product_id, component_ids)
      select ${t}::uuid, k.id, k.top_ord + 1 + comp.ord, comp.name, comp.unit, comp.qty, comp.unit_price, true, true,
        comp.product_id, comp.comps
      from k, comp where comp.id is null and (select n from bad) = 0
      returning id)`;
}

/** CTE `rp` (thay mốc AI/mặc định còn mở) + `mi` (mốc mới) của ②. */
function milestoneCtes(t: string, id: string, w: ReviewWrite) {
  const ms = (w.plan.milestones ?? []).map((m, ord) => ({ ...m, ord }));
  return sql`rp as (
      update contracts.obligations o set status = 'replaced', updated_at = now()
      where ${w.plan.milestones !== null}::boolean and o.tenant_id = ${t}::uuid and o.contract_id = ${id}::uuid
        and o.source in ('ai', 'default') and o.status = 'open'
      returning o.id),
    mi as (
      insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, qty, title,
        owner, source)
      select ${t}::uuid, k.id, k.party, m.direction, m.kind, k.top + 1 + m.ord, m.due_date, m.amount, null, m.title, m.owner,
        m.source
      from k, jsonb_to_recordset(${JSON.stringify(ms)}::jsonb) as m (ord int, kind text, direction text, due_date date,
        amount bigint, title text, owner text, source text)
      where ${w.plan.milestones !== null}::boolean
      returning id)`;
}

function saveQ(tx: Tx, t: string): ReviewRepo["save"] {
  return async (id, w): Promise<ReviewSaveOutcome> => {
    const p = w.plan;
    const head = await tx.execute<{ version: number }>(sql`update contracts.contracts set
        fields = ${JSON.stringify(p.fields)}::jsonb, deal = ${p.deal}, direction = ${p.direction},
        commission_pct = ${p.commissionPct}::numeric, commission_fixed = ${p.commissionFixed}::bigint,
        version = version + 1, updated_at = now()
      where id = ${id}::uuid and tenant_id = ${t}::uuid and version = ${w.expected}::int and status = 'needs_review'
      returning version`);
    if (!head[0]) return "stale";
    const c = await itemsAndMilestones(tx, t, id, w);
    if (c.bad > 0) return "component_invalid";
    const asked = (w.items ?? []).filter((i) => i.id !== null).length;
    if (c.unk > 0 || c.upd !== asked) return "item_unknown";
    const done = await tx.execute<{ status: "needs_review" | "active" }>(sql`with u as (
        update contracts.contracts set status = case when ${p.activate}::boolean then 'active' else status end,
          confirmed_at = case when ${p.activate}::boolean then now() else confirmed_at end,
          confirmed_by = case when ${p.activate}::boolean then ${w.actor}::uuid else confirmed_by end
        where id = ${id}::uuid and tenant_id = ${t}::uuid
        returning id, status),
      a as (
        update contracts.approvals x set status = 'done', decided_by = ${w.actor}::uuid, decided_at = now(),
          level1_by = coalesce(x.level1_by, ${w.actor}::uuid), level1_at = coalesce(x.level1_at, now()), updated_at = now()
        from u where ${p.activate}::boolean and x.tenant_id = ${t}::uuid and x.contract_id = u.id
          and x.status in ('extracting', 'level1', 'level2')),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${t}::uuid, u.id, 'review_saved', ${w.actor}::uuid, jsonb_build_object('deal', ${p.deal}::text,
          'status', u.status, 'items', ${c.upd + c.ins}::int, 'milestones', ${c.ms}::int,
          'fields', ${JSON.stringify(p.changes.map((x) => x.key))}::jsonb) from u)
      select status from u`);
    const status = done[0]?.status;
    if (!status) throw new Error("review-save: contract vanished under lock");
    return { version: head[0].version, status, items: c.upd + c.ins, milestones: c.ms };
  };
}

function attachQ(tx: Tx, t: string): ReviewRepo["attachProduct"] {
  return async (id, itemId, p, actor): Promise<AttachOutcome> => {
    const comps = p.component_ids ? pgTextArray(p.component_ids) : null;
    const rows = await tx.execute<{
      found: boolean;
      locked: boolean;
      clocked: boolean;
      ok: boolean;
    }>(sql`with it as (
        select i.id from contracts.contract_items i
        where i.id = ${itemId}::uuid and i.contract_id = ${id}::uuid and i.tenant_id = ${t}::uuid),
      lk as (
        select (c.locked_at is not null or c.status = 'extracting' or exists (select 1 from contracts.stock_moves m
          where m.tenant_id = ${t}::uuid and m.contract_id = c.id)) as locked
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid),
      ck as (
        select (${comps}::uuid[] is null or ${comps}::uuid[] <@ coalesce((select array_agg(pc.id)
          from contracts.product_components pc
          where pc.product_id = ${p.product_id}::uuid and pc.tenant_id = ${t}::uuid), '{}'::uuid[])) as ok),
      u as (
        update contracts.contract_items i set product_id = ${p.product_id}::uuid, component_ids = ${comps}::uuid[]
        where i.id = ${itemId}::uuid and i.tenant_id = ${t}::uuid and exists (select 1 from it)
          and not coalesce((select locked from lk), true) and (select ok from ck)
        returning i.id, i.product_id, i.component_ids),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${t}::uuid, ${id}::uuid, 'item_product_set', ${actor}::uuid,
          jsonb_build_object('item_id', u.id, 'product_id', u.product_id) from u)
      select exists (select 1 from it) as found, coalesce((select locked from lk), false) as locked,
        coalesce((select c.locked_at is not null from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid), false) as clocked,
        (select ok from ck) as ok`);
    const r = rows[0];
    if (!r?.found) return { kind: "not_found" };
    if (r.clocked) return { kind: "contract_locked" };
    if (r.locked) return { kind: "locked" };
    if (!r.ok) return { kind: "component_invalid" };
    return {
      kind: "ok",
      item: { id: itemId, product_id: p.product_id, component_ids: p.component_ids },
    };
  };
}

export function reviewRepo(tx: Tx, tenantId: string): ReviewRepo {
  return {
    lock: lockQ(tx, tenantId),
    save: saveQ(tx, tenantId),
    attachProduct: attachQ(tx, tenantId),
  };
}
