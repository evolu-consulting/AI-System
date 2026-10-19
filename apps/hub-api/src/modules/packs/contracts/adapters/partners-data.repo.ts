// HD8-FR-01 · HD8-FR-05 · HD8-NFR-01 (Luật 4c): MỘT câu đọc mọi thứ để chấm điểm + so giá, ở phạm vi người dùng (RLS M1: chỉ HĐ
// người dùng thấy, D8-04; sổ đối tác không có policy M1 ⇒ cả sổ như mgmt). Đo trước khi tối ưu (evotest, 2.000 HĐ / 10.000 dòng sổ):
// mỗi HĐ một object `jsonb` + hàm SQL theo hàng (`party_key`, `as_date`, `user_label` — `SET search_path` ⇒ không inline) tốn
// 1,4 s. Giờ: sự thật HĐ gom ở SQL theo (vai, tên, MST) bên đối tác; chỉ HĐ mua (bên NCC) mới kèm dòng hàng (giá chỉ cần phía NCC);
// mảng `json` gọn; sự kiện theo index `(tenant_id, party_key, at, id)` (không sắp); khoá đối tác + ngày kiểm ở TS (`partyKey` ≡ SQL).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PriceItem } from "../domain/appendix-pricing.rules";
import type { PricedContract, Quote } from "../domain/goods-prices.rules";
import { isIsoDate, partyKey } from "../domain/ledger.rules";
import type { FactRow, PartyEv } from "../domain/partners.rules";
import type { Criterion, Role, Rules } from "../domain/scoring-config.rules";
import { one } from "./ledger-sql";

export type StoredConfig = {
  role: Role;
  version: number;
  criteria: Criterion[];
  rules: Rules;
  updated_by: string | null;
  updated_at: string | null;
};
export type PartnerData = {
  facts: FactRow[];
  /** HĐ mua đã duyệt (mọi loại) + dòng hàng — đủ cho giá phía NCC (chênh giá, so giá). */
  contracts: PricedContract[];
  events: PartyEv[];
  configs: StoredConfig[];
  quotes: Quote[];
};

const CONFIRMED = sql`('active', 'expiring', 'expired', 'renewed', 'terminated')`;
const ISO = sql`'^\\d{4}-\\d{2}-\\d{2}$'`;
const side = (c: string) =>
  sql.raw(`case when ${c}.direction = 'sale' then 'buyer' else 'supplier' end`);

/** HĐ đã duyệt người dùng thấy; bên đối tác của phụ lục = của HĐ gốc khi gốc có (`coalesce(ps, s)` của mgmt). */
const kCte = sql`k as (
    select c.id, c.tenant_id, c.kind, c.status, c.parent_id, c.title, c.created_at,
      coalesce(c.direction, par.direction) as dir,
      c.fields -> 'start_date' ->> 'value' as s1, c.fields -> 'signed_date' ->> 'value' as s2,
      c.fields -> 'effective_date' ->> 'value' as eff,
      src.f -> (src.sd || '_name') ->> 'value' as pname, src.f -> (src.sd || '_tax_id') ->> 'value' as ptax
    from contracts.contracts c
    left join contracts.contracts par on par.tenant_id = c.tenant_id and par.id = c.parent_id
    cross join lateral (select case when par.id is not null and coalesce(
          par.fields -> (${side("par")} || '_name') ->> 'value', par.fields -> (${side("par")} || '_tax_id') ->> 'value')
          is not null then par.fields else c.fields end as f,
        case when coalesce(c.direction, par.direction) = 'sale' then 'buyer' else 'supplier' end as sd) src
    where c.tenant_id = (select t from p) and c.status in ${CONFIRMED}
      and not exists (select 1 from contracts.cks_renewals r where r.tenant_id = c.tenant_id
        and r.new_contract_id = c.id and r.status = 'lost'))`;

/** `_facts` gom theo (vai, tên, MST): số HĐ, ngày bắt đầu sớm nhất (start ?? signed, đúng dạng ngày). */
const factsJson = sql`coalesce((select json_agg(json_build_array(g.role, g.pname, g.ptax, g.n, g.first_start)
    order by g.first_at, g.pname, g.ptax) from (
    select case when k.dir = 'sale' then 'customer' else 'supplier' end as role, k.pname, k.ptax, count(*) as n,
      min(coalesce(case when k.s1 ~ ${ISO} then k.s1 end, case when k.s2 ~ ${ISO} then k.s2 end)) as first_start,
      min(k.created_at) as first_at
    from k where k.kind = 'contract' group by 1, 2, 3) g), '[]'::json)`;

const buyJson = sql`coalesce((select json_agg(json_build_array(b.id, b.kind, b.status, b.parent_id, b.dir, b.title, b.eff,
    b.pname, b.ptax) order by b.created_at, b.id) from b), '[]'::json)`;

const itemsJson = sql`coalesce((select json_agg(json_build_array(i.contract_id, i.code, i.name, i.spec, i.unit, i.qty,
    i.unit_price, i.vat_rate, i.valid_from, i.valid_to) order by i.contract_id, i.ord)
  from contracts.contract_items i where i.tenant_id = (select t from p) and i.contract_id in (select id from b)), '[]'::json)`;

const eventsJson = sql`coalesce((select json_agg(json_build_array(e.id::text, e.party_key, e.role, e.type, e.at,
    v.event_id is not null, e.days_late, e.obligation_id, e.data,
    case when e.type = 'rating' then contracts.user_label(e.by_user) end, e.note) order by e.party_key, e.at, e.id)
  from contracts.partner_events e
  left join contracts.partner_event_voids v on v.event_id = e.id and v.tenant_id = e.tenant_id
  where e.tenant_id = (select t from p)), '[]'::json)`;

const restJson = sql`'configs', coalesce((select json_agg(json_build_object('role', s.role, 'version', s.version,
      'criteria', s.criteria, 'rules', s.rules, 'updated_by', contracts.user_label(s.updated_by),
      'updated_at', s.updated_at)) from contracts.score_configs s where s.tenant_id = (select t from p)), '[]'::json),
  'quotes', coalesce((select json_agg(json_build_object('id', q.id, 'product_key', q.product_key,
      'product_name', q.product_name, 'unit', q.unit, 'supplier_name', q.supplier_name,
      'supplier_party_key', q.supplier_party_key, 'price', q.price, 'quoted_at', q.quoted_at, 'source', q.source,
      'url', q.url) order by q.quoted_at, q.created_at, q.id)
    from contracts.price_quotes q where q.tenant_id = (select t from p)), '[]'::json)`;

type S = string | null;
type Raw = {
  facts: [Role, S, S, number, S][];
  buy: [string, "contract" | "appendix", string, S, S, string, S, S, S][];
  items: [string, S, string, S, S, number | null, number | null, number | null, S, S][];
  events: [string, string, Role, string, string, boolean, number | null, S, object, S, S][];
  configs: StoredConfig[];
  quotes: Quote[];
};

function itemsBy(rows: Raw["items"]): Map<string, PriceItem[]> {
  const out = new Map<string, PriceItem[]>();
  for (const [
    cid,
    code,
    name,
    spec,
    unit,
    qty,
    unit_price,
    vat_rate,
    valid_from,
    valid_to,
  ] of rows) {
    const it = { code, name, spec, unit, qty, unit_price, vat_rate, valid_from, valid_to };
    const a = out.get(cid);
    if (a) a.push(it);
    else out.set(cid, [it]);
  }
  return out;
}

/** Mảng gọn ⇒ hình miền (sự kiện trải `data` như mgmt). */
function toData(r: Raw): PartnerData {
  const items = itemsBy(r.items);
  const day = (v: S) => (v && isIsoDate(v) ? v : null);
  return {
    facts: r.facts.map(([role, name, tax, n, first_start]) => ({
      role,
      name,
      tax,
      party: partyKey(name, tax),
      n,
      first_start: day(first_start),
    })),
    contracts: r.buy.map(([id, kind, status, parent, direction, title, eff, pname, ptax]) => ({
      id,
      kind,
      status,
      parent,
      direction,
      title,
      eff: day(eff),
      party: partyKey(pname, ptax),
      party_name: pname,
      items: items.get(id) ?? [],
    })),
    events: r.events.map(
      ([id, party, role, type, at, voided, days_late, obligation_id, data, by, note]) => ({
        ...data,
        id,
        party,
        role,
        type,
        at,
        voided,
        days_late,
        obligation_id,
        by,
        note,
      }),
    ),
    configs: r.configs,
    quotes: r.quotes,
  };
}

/** MỘT câu: sự thật HĐ (gom), HĐ mua + dòng hàng, sổ đối tác, cấu hình, báo giá. HĐ CKS gia hạn mất khách không tính (`lost_renewal`). */
export async function partnerData(tx: Tx, t: string): Promise<PartnerData> {
  const raw = await one<Raw>(
    tx,
    sql`with p as (select ${t}::uuid as t), ${kCte},
      b as (select * from k where coalesce(k.dir, '') <> 'sale')
    select json_build_object('facts', ${factsJson}, 'buy', ${buyJson}, 'items', ${itemsJson}, 'events', ${eventsJson},
      ${restJson}) as j`,
  );
  return toData(raw);
}
