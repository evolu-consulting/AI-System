// HD8-FR-01 · HD8-FR-05 · HD8-NFR-01 (Luật 4c): MỘT câu đọc mọi thứ để chấm điểm + so giá, ở phạm vi người dùng (RLS M1/M1b: HĐ
// người dùng thấy; sổ đối tác: mọi dòng của đối tác người dùng thấy ⇒ điểm trên cả sổ của đối tác đó như mgmt, D8-04). Bản đầu (mỗi
// HĐ một object `jsonb` + hàm SQL theo hàng `party_key`/`as_date`/`user_label`, không inline được) tốn 1,4 s trên 10.000 HĐ/dòng sổ.
// Giờ: sự thật HĐ gom ngay trên `contracts` theo (vai, tên, MST) bên đối tác; chỉ HĐ phía mua kèm dòng hàng (giá chỉ cần bên NCC),
// HĐ cha chỉ tra cho phụ lục; sổ đối tác GOM theo (đối tác, vai) ở SQL (≡ `aggregate`); mảng `json` gọn; khoá đối tác + ngày ở TS.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PriceItem } from "../domain/appendix-pricing.rules";
import type { PricedContract, Quote } from "../domain/goods-prices.rules";
import { isIsoDate, partyKey } from "../domain/ledger.rules";
import { aggKey, type FactRow, type PartyEv } from "../domain/partners.rules";
import { type Agg, emptyAgg } from "../domain/scoring-agg.rules";
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
  /** Sổ đối tác đã gom, khoá `aggKey(đối tác, vai)`. */
  aggs: Map<string, Agg>;
  configs: StoredConfig[];
  quotes: Quote[];
  /** Danh bạ: khoá đối tác ⇒ tên ngắn ?? tên (HD8-FR-09). */
  names: Map<string, string>;
  /** Giá thị trường hàng hoá theo mặt hàng (HD8-FR-08). */
  market: Map<string, Market>;
};
export type Market = { min: number; max: number; seen: string; n: number };

const ISO = sql`'^\\d{4}-\\d{2}-\\d{2}$'`;

/** HĐ đã duyệt người dùng thấy (RLS), trừ HĐ gia hạn CKS mất khách (`lost_renewal`). */
const confirmed = (c: string) =>
  sql.raw(`${c}.tenant_id = (select t from p) and ${c}.status in
    ('active', 'expiring', 'expired', 'renewed', 'terminated')
    and not exists (select 1 from contracts.cks_renewals r where r.tenant_id = ${c}.tenant_id
      and r.new_contract_id = ${c}.id and r.status = 'lost')`);

/**
 * HĐ phía mua (giá chỉ cần bên NCC): HĐ gốc không phải bán + phụ lục (bên + chiều theo HĐ gốc khi gốc có, `coalesce(ps, s)` của
 * mgmt). HĐ gốc không join (không có cha); chỉ phụ lục tra HĐ cha theo id.
 */
const bCte = sql`b as (
    select c.id, c.kind, c.status, c.parent_id, c.title, c.created_at, c.direction as dir,
      c.fields -> 'effective_date' ->> 'value' as eff,
      c.fields -> 'supplier_name' ->> 'value' as pname, c.fields -> 'supplier_tax_id' ->> 'value' as ptax
    from contracts.contracts c
    where ${confirmed("c")} and c.kind = 'contract' and c.direction is distinct from 'sale'
    union all
    select a.id, a.kind, a.status, a.parent_id, a.title, a.created_at, coalesce(a.direction, par.direction),
      a.fields -> 'effective_date' ->> 'value',
      src.f -> (src.sd || '_name') ->> 'value', src.f -> (src.sd || '_tax_id') ->> 'value'
    from contracts.contracts a
    left join lateral (select x.direction, x.fields from contracts.contracts x
      where x.tenant_id = a.tenant_id and x.id = a.parent_id limit 1) par on true
    cross join lateral (select case when coalesce(a.direction, par.direction) = 'sale' then 'buyer' else 'supplier' end as sd) s0
    cross join lateral (select s0.sd, case when par.fields is not null and coalesce(par.fields -> (s0.sd || '_name') ->> 'value',
          par.fields -> (s0.sd || '_tax_id') ->> 'value') is not null then par.fields else a.fields end as f) src
    where ${confirmed("a")} and a.kind = 'appendix' and coalesce(a.direction, par.direction) is distinct from 'sale')`;

/** `_facts` gom ngay trên `contracts` (HĐ gốc, không cần HĐ cha) theo (vai, tên, MST): số HĐ, ngày bắt đầu sớm nhất. */
const factsJson = sql`coalesce((select json_agg(json_build_array(g.role, g.pname, g.ptax, g.n, g.first_start)
    order by g.first_at, g.pname, g.ptax) from (
    select x.role, x.pname, x.ptax, count(*) as n, min(x.st) as first_start, min(x.created_at) as first_at
    from (select case when c.direction = 'sale' then 'customer' else 'supplier' end as role,
        c.fields -> (case when c.direction = 'sale' then 'buyer_name' else 'supplier_name' end) ->> 'value' as pname,
        c.fields -> (case when c.direction = 'sale' then 'buyer_tax_id' else 'supplier_tax_id' end) ->> 'value' as ptax,
        coalesce(case when c.fields -> 'start_date' ->> 'value' ~ ${ISO} then c.fields -> 'start_date' ->> 'value' end,
          case when c.fields -> 'signed_date' ->> 'value' ~ ${ISO} then c.fields -> 'signed_date' ->> 'value' end) as st,
        c.created_at
      from contracts.contracts c where ${confirmed("c")} and c.kind = 'contract') x
    group by 1, 2, 3) g), '[]'::json)`;

// Luật 4c: các tập lớn đi dạng CỘT (`array_agg` từng cột, một `to_json` mỗi mảng) — không dựng một mảng json cho từng hàng.
// Thứ tự trong mọi cột của một tập = thứ tự của truy vấn con đã sắp (Postgres giữ thứ tự đầu vào cho `array_agg`).
const buyJson = sql`(select json_build_array(array_agg(b.id), array_agg(b.kind), array_agg(b.status), array_agg(b.parent_id),
    array_agg(b.dir), array_agg(b.title), array_agg(b.eff), array_agg(b.pname), array_agg(b.ptax))
  from (select * from b order by b.created_at, b.id) b)`;

const itemsJson = sql`(select json_build_array(array_agg(i.contract_id), array_agg(i.code), array_agg(i.name),
    array_agg(i.spec), array_agg(i.unit), array_agg(i.qty), array_agg(i.unit_price), array_agg(i.vat_rate),
    array_agg(i.valid_from), array_agg(i.valid_to))
  from (select i.* from contracts.contract_items i where i.tenant_id = (select t from p)
    and i.contract_id in (select id from b) order by i.contract_id, i.ord) i)`;

/**
 * HD8-NFR-01: sổ đối tác GOM ở SQL theo (đối tác, vai) — ≡ `aggregate()` (scoring-agg.rules.ts), test parity ngẫu nhiên
 * `HD8/agg-parity.int.test.ts`. Khoảng tính theo vai: `round(m·30,44)` với m nguyên không bao giờ rơi đúng .5 ⇒ làm tròn SQL ≡
 * Python; `ov` = khoảng của bản nháp (xem trước/lưu) đè cấu hình đã lưu. Dòng đã huỷ bị bỏ (engine bỏ qua).
 */
const winCtes = (today: string, ov: unknown) => sql`rw as (
    select x.role,
      ${today}::date - round(coalesce((${JSON.stringify(ov ?? {})}::jsonb -> x.role ->> 'window_months')::int,
        (s.rules ->> 'window_months')::int, 12) * 30.44)::int as start,
      ${today}::date - round(coalesce((${JSON.stringify(ov ?? {})}::jsonb -> x.role ->> 'recency_months')::int,
        (s.rules ->> 'recency_months')::int, 3) * 30.44)::int as recent
    from (values ('customer'), ('supplier')) x (role)
    left join contracts.score_configs s on s.tenant_id = (select t from p) and s.role = x.role),
  w as (
    select e.id, e.party_key, e.role, e.type, e.at, e.days_late, e.obligation_id, e.data, e.by_user, e.at >= rw.recent as nw
    from contracts.partner_events e join rw on rw.role = e.role
    where e.tenant_id = (select t from p) and e.at between rw.start and ${today}::date
      and e.id not in (select v.event_id from contracts.partner_event_voids v where v.tenant_id = (select t from p))),
  pd as (
    select o.party_key, o.role, o.nw, greatest(1, ${today}::date - contracts.as_date(o.data ->> 'due_date')) as dl
    from w o
    where o.type = 'overdue' and o.data ->> 'party_late' = 'true'
      and (o.role = 'supplier') = coalesce(o.data ->> 'kind' = 'delivery', false)
      and not exists (select 1 from w s where s.party_key = o.party_key and s.role = o.role
        and s.type in ('paid', 'received', 'delivered') and s.obligation_id is not distinct from o.obligation_id)
      and not exists (select 1 from w s where s.party_key = o.party_key and s.role = o.role and s.type = 'postponed'
        and s.obligation_id is not distinct from o.obligation_id and s.at >= o.at))`;

const AGG_COLS = sql`
    count(*) filter (where w.type = z.own and not w.nw),
    count(*) filter (where w.type = z.own and not w.nw and coalesce(w.days_late, 0) = 0),
    coalesce(sum(w.days_late) filter (where w.type = z.own and not w.nw), 0),
    count(*) filter (where w.type = z.own and w.nw),
    count(*) filter (where w.type = z.own and w.nw and coalesce(w.days_late, 0) = 0),
    coalesce(sum(w.days_late) filter (where w.type = z.own and w.nw), 0),
    count(*) filter (where w.type in ('cks_renewed', 'cks_lapsed')),
    coalesce(sum(case
        when w.type = 'cks_lapsed' or (w.data ? 'with_us' and coalesce(w.data ->> 'with_us', '') in ('false', '', '0')) then 0
        when coalesce((w.data ->> 'days_before_expiry')::int, 0) >= 0 then 100
        else greatest(0, 100 + 10 * (w.data ->> 'days_before_expiry')::int) end)
      filter (where w.type in ('cks_renewed', 'cks_lapsed')), 0),
    count(*) filter (where w.type = 'reminded'),
    bool_or(w.type in ('received', 'paid', 'delivered', 'postponed', 'reminded')),
    count(*) filter (where w.type = 'appointment_kept'),
    count(*) filter (where w.type = 'appointment_missed'),
    count(*) filter (where w.type = 'postponed'),
    count(*) filter (where w.type = 'complaint'),
    coalesce(sum(coalesce((w.data ->> 'delta')::int, 0)) filter (where w.type = 'manual_adjust'), 0),
    count(*) filter (where w.type not in ('manual_adjust', 'rating', 'overdue'))`;

const aggJson = sql`coalesce((select json_agg(json_build_array(g.party_key, g.role, g.a,
      coalesce(pa.p0n, 0), coalesce(pa.p0l, 0), coalesce(pa.p1n, 0), coalesce(pa.p1l, 0)))
    from (select w.party_key, w.role, json_build_array(${AGG_COLS}) as a
      from w cross join lateral (select case when w.role = 'customer' then 'received' else 'delivered' end as own) z
      group by w.party_key, w.role) g
    left join (select pd.party_key, pd.role,
        count(*) filter (where not pd.nw) as p0n, coalesce(sum(pd.dl) filter (where not pd.nw), 0) as p0l,
        count(*) filter (where pd.nw) as p1n, coalesce(sum(pd.dl) filter (where pd.nw), 0) as p1l
      from pd group by pd.party_key, pd.role) pa on pa.party_key = g.party_key and pa.role = g.role), '[]'::json)`;

/** `_rated`: lần chấm mới nhất mỗi (đối tác, vai, tiêu chí) trong khoảng tính — theo (`at`, `rated_at`, id). */
const ratedJson = sql`coalesce((select json_agg(json_build_array(r.party_key, r.role, r.cr, r.v, r.at, r.by)) from (
    select distinct on (w.party_key, w.role, w.data ->> 'criterion') w.party_key, w.role, w.data ->> 'criterion' as cr,
      (w.data ->> 'value')::int as v, w.at, contracts.user_label(w.by_user) as by
    from w where w.type = 'rating'
    order by w.party_key, w.role, w.data ->> 'criterion', w.at desc,
      coalesce(w.data ->> 'rated_at', '') collate "C" desc, w.id desc) r), '[]'::json)`;
const restJson = sql`'configs', coalesce((select json_agg(json_build_object('role', s.role, 'version', s.version,
      'criteria', s.criteria, 'rules', s.rules, 'updated_by', contracts.user_label(s.updated_by),
      'updated_at', s.updated_at)) from contracts.score_configs s where s.tenant_id = (select t from p)), '[]'::json),
  'quotes', coalesce((select json_agg(json_build_object('id', q.id, 'product_key', q.product_key,
      'product_name', q.product_name, 'unit', q.unit, 'supplier_name', q.supplier_name,
      'supplier_party_key', q.supplier_party_key, 'price', q.price, 'quoted_at', q.quoted_at, 'source', q.source,
      'url', q.url, 'verified', q.verified) order by q.quoted_at, q.created_at, q.id)
    from contracts.price_quotes q where q.tenant_id = (select t from p)), '[]'::json),
  'names', coalesce((select json_agg(json_build_array(co.party_key, coalesce(nullif(co.short_name, ''), co.name)))
    from contracts.companies co where co.tenant_id = (select t from p)
      and coalesce(nullif(co.short_name, ''), co.name) is not null), '[]'::json)`;

/** `compare.market`: quan sát giá công khai 30 ngày gần nhất mỗi mặt hàng (min/max/ngày mới nhất/số nguồn). */
const marketJson = (
  today: string,
) => sql`coalesce((select json_agg(json_build_array(g.k, g.mn, g.mx, g.sn, g.n)) from (
    select m.product_key as k, min(m.price_ex_vat) as mn, max(m.price_ex_vat) as mx, max(m.seen) as sn, count(*) as n
    from contracts.market_observations m where m.tenant_id = (select t from p) and m.seen >= ${today}::date - 30
    group by m.product_key) g), '[]'::json)`;

type S = string | null;
type N = number | null;
/** Một tập dạng cột: mỗi phần tử là MỘT cột (null khi tập rỗng). */
type Cols<T extends unknown[]> = { [K in keyof T]: T[K][] | null };
type Raw = {
  facts: [Role, S, S, number, S][];
  buy: Cols<[string, "contract" | "appendix", string, S, S, string, S, S, S]>;
  items: Cols<[string, S, string, S, S, N, N, N, S, S]>;
  agg: AggRow[];
  rated: RatedRow[];
  configs: StoredConfig[];
  quotes: Quote[];
  names: [string, string][];
  market: [string, number, number, string, number][];
};
const col = <T>(c: T[] | null | undefined): T[] => c ?? [];
/** Mọi cột của một tập (cột null ⇒ rỗng). */
const colsOf = (c: unknown): unknown[][] => (c as (unknown[] | null)[]).map((x) => x ?? []);
const rowsOf = <T extends unknown[]>(cols: Cols<T>): number => col(cols[0] as unknown[]).length;

function itemsBy(c: Raw["items"]): Map<string, PriceItem[]> {
  const out = new Map<string, PriceItem[]>();
  const [cid, code, name, spec, unit, qty, price, vat, from, to] = colsOf(c) as unknown as [
    string[],
    S[],
    string[],
    S[],
    S[],
    N[],
    N[],
    N[],
    S[],
    S[],
  ];
  for (let i = 0; i < rowsOf(c); i++) {
    const it: PriceItem = {
      code: code[i] ?? null,
      name: name[i] as string,
      spec: spec[i] ?? null,
      unit: unit[i] ?? null,
      qty: qty[i] ?? null,
      unit_price: price[i] ?? null,
      vat_rate: vat[i] ?? null,
      valid_from: from[i] ?? null,
      valid_to: to[i] ?? null,
    };
    const a = out.get(cid[i] as string);
    if (a) a.push(it);
    else out.set(cid[i] as string, [it]);
  }
  return out;
}

const day = (v: S | undefined) => (v && isIsoDate(v) ? v : null);

function buyOf(c: Raw["buy"], items: Map<string, PriceItem[]>): PricedContract[] {
  const [id, kind, status, parent, dir, title, eff, pname, ptax] = colsOf(c) as unknown as [
    string[],
    ("contract" | "appendix")[],
    string[],
    S[],
    S[],
    string[],
    S[],
    S[],
    S[],
  ];
  return id.map((x, i) => ({
    id: x,
    kind: kind[i] as "contract" | "appendix",
    status: status[i] as string,
    parent: parent[i] ?? null,
    direction: dir[i] ?? null,
    title: title[i] as string,
    eff: day(eff[i]),
    party: partyKey(pname[i], ptax[i]),
    party_name: pname[i] ?? null,
    items: items.get(x) ?? [],
  }));
}

type AggRow = [string, Role, number[], number, number, number, number];
type RatedRow = [string, Role, string, number, string, S];

/** Hàng gom SQL ⇒ `Agg` (thứ tự cột = `AGG_COLS`). */
export function aggOf(row: AggRow): Agg {
  const [, , a, p0n, p0l, p1n, p1l] = row;
  const [s0n, s0on, s0l, s1n, s1on, s1l, rn, rs, rem, deal, kept, missed, post, comp, adj, cnt] =
    a as unknown as [...number[]];
  return {
    set: [
      { n: Number(s0n), on: Number(s0on), late: Number(s0l) },
      { n: Number(s1n), on: Number(s1on), late: Number(s1l) },
    ],
    pend: [
      { n: Number(p0n), on: 0, late: Number(p0l) },
      { n: Number(p1n), on: 0, late: Number(p1l) },
    ],
    renew_n: Number(rn),
    renew_sum: Number(rs),
    reminded: Number(rem),
    dealings: (deal as unknown) === true,
    kept: Number(kept),
    missed: Number(missed),
    postponed: Number(post),
    complaints: Number(comp),
    adjust: Number(adj),
    counted: Number(cnt),
    rated: {},
  };
}

function aggsOf(rows: AggRow[], rated: RatedRow[]): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const r of rows) out.set(aggKey(r[0], r[1]), aggOf(r));
  for (const [party, role, cr, v, at, by] of rated) {
    const key = aggKey(party, role);
    const a = out.get(key) ?? emptyAgg();
    a.rated[cr] = { value: v, at, by };
    out.set(key, a);
  }
  return out;
}

/** Cột ⇒ hình miền. */
function toData(r: Raw): PartnerData {
  return {
    facts: r.facts.map(([role, name, tax, n, first_start]) => ({
      role,
      name,
      tax,
      party: partyKey(name, tax),
      n,
      first_start: day(first_start),
    })),
    contracts: buyOf(r.buy, itemsBy(r.items)),
    aggs: aggsOf(r.agg, r.rated),
    configs: r.configs,
    quotes: r.quotes,
    names: new Map(r.names),
    market: new Map(r.market.map(([k, min, max, seen, n]) => [k, { min, max, seen, n }])),
  };
}

/** Khoảng tính đè theo vai (bản nháp xem trước/lưu). */
export type WindowOverride = Partial<
  Record<Role, { window_months: number; recency_months: number }>
>;

/**
 * MỘT câu: sự thật HĐ (gom), HĐ mua + dòng hàng, sổ đối tác ĐÃ GOM theo (đối tác, vai) + lần chấm tay mới nhất, cấu hình, báo giá.
 * HĐ CKS gia hạn mất khách không tính (`lost_renewal`).
 */
export async function partnerData(
  tx: Tx,
  t: string,
  today: string,
  ov: WindowOverride = {},
): Promise<PartnerData> {
  const raw = await one<Raw>(
    tx,
    sql`with p as (select ${t}::uuid as t), ${bCte}, ${winCtes(today, ov)}
    select json_build_object('facts', ${factsJson}, 'buy', ${buyJson}, 'items', ${itemsJson}, 'agg', ${aggJson},
      'rated', ${ratedJson}, 'market', ${marketJson(today)}, ${restJson}) as j`,
  );
  return toData(raw);
}

/** Mọi lần chấm tay (chưa huỷ) của MỘT đối tác + vai — cho "Điểm tự chấm" (lịch sử cả ngoài khoảng tính, như mgmt). */
export async function ratingEvents(
  tx: Tx,
  t: string,
  party: string,
  role: Role,
): Promise<PartyEv[]> {
  const rows = await one<PartyEv[]>(
    tx,
    sql`select coalesce(json_agg(e.data || jsonb_build_object('id', e.id::text, 'party', e.party_key, 'role', e.role,
        'type', e.type, 'at', e.at, 'by', contracts.user_label(e.by_user), 'note', e.note) order by e.at, e.id), '[]'::json) as j
      from contracts.partner_events e
      where e.tenant_id = ${t}::uuid and e.party_key = ${party} and e.role = ${role} and e.type = 'rating'
        and not exists (select 1 from contracts.partner_event_voids v where v.event_id = e.id and v.tenant_id = e.tenant_id)`,
  );
  return rows;
}
