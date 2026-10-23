// HD8-FR-01 · HD8-FR-05 · HD8-NFR-01 (Luật 4c): MỘT câu đọc mọi thứ để chấm điểm + so giá, ở phạm vi người dùng (RLS M1/M1b: HĐ
// người dùng thấy; sổ đối tác: mọi dòng của đối tác người dùng thấy ⇒ điểm trên cả sổ của đối tác đó như mgmt, D8-04). Bản đầu (mỗi
// HĐ một object `jsonb` + hàm SQL theo hàng `party_key`/`as_date`/`user_label`, không inline được) tốn 1,4 s trên 10.000 HĐ/dòng sổ.
// Giờ: sự thật HĐ gom ngay trên `contracts` theo (vai, tên, MST) bên đối tác; chỉ HĐ phía mua kèm dòng hàng (giá chỉ cần bên NCC),
// HĐ cha chỉ tra cho phụ lục; sổ đối tác GOM theo (đối tác, vai) ở SQL (≡ `aggregate`); mảng `json` gọn; khoá đối tác + ngày ở TS.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  Market,
  PartnerData,
  StoredConfig,
  WindowOverride,
} from "../application/partners.ports";
import type { PriceItem } from "../domain/appendix-pricing.rules";
import type { PricedContract, Quote } from "../domain/goods-prices.rules";
import { isIsoDate, partyKey } from "../domain/ledger.rules";
import { aggKey, type PartyEv } from "../domain/partners.rules";
import { type Agg, addGroup, emptyAgg } from "../domain/scoring-agg.rules";
import type { Role } from "../domain/scoring-config.rules";
import { one } from "./ledger-sql";
import { groupsJson, pendJson, ratedJson, winCtes } from "./partners-ledger.sql";

export type { Market, PartnerData, StoredConfig, WindowOverride };

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
    where ${confirmed("c")} and c.kind = 'contract' and c.direction is distinct from 'sale' and c.superseded_at is null
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

/** CR-097 K2: chuỗi phiên bản đếm MỘT HĐ (`root_id`), ngày bắt đầu sớm nhất gồm cả bản đã bị thay (decision 5: tenure từ v1).
 *  `_facts` gom ngay trên `contracts` (HĐ gốc, không cần HĐ cha) theo (vai, tên, MST): số HĐ, ngày bắt đầu sớm nhất. */
const factsJson = sql`coalesce((select json_agg(json_build_array(g.role, g.pname, g.ptax, g.n, g.first_start)
    order by g.first_at, g.pname, g.ptax) from (
    select x.role, x.pname, x.ptax, count(distinct x.root_id) as n, min(x.st) as first_start, min(x.created_at) as first_at
    from (select case when c.direction = 'sale' then 'customer' else 'supplier' end as role,
        c.fields -> (case when c.direction = 'sale' then 'buyer_name' else 'supplier_name' end) ->> 'value' as pname,
        c.fields -> (case when c.direction = 'sale' then 'buyer_tax_id' else 'supplier_tax_id' end) ->> 'value' as ptax,
        coalesce(case when c.fields -> 'start_date' ->> 'value' ~ ${ISO} then c.fields -> 'start_date' ->> 'value' end,
          case when c.fields -> 'signed_date' ->> 'value' ~ ${ISO} then c.fields -> 'signed_date' ->> 'value' end) as st,
        c.created_at, c.root_id
      from contracts.contracts c where ${confirmed("c")} and c.kind = 'contract') x
    group by 1, 2, 3) g), '[]'::json)`;

// Luật 4c: các tập lớn đi dạng CỘT (`array_agg` từng cột, một `to_json` mỗi mảng) — không dựng một mảng json cho từng hàng.
// Thứ tự trong mọi cột của một tập = thứ tự của truy vấn con đã sắp (Postgres giữ thứ tự đầu vào cho `array_agg`).
const buyJson = sql`(select json_build_array(array_agg(b.id), array_agg(b.kind), array_agg(b.status), array_agg(b.parent_id),
    array_agg(b.dir), array_agg(b.title), array_agg(b.eff), array_agg(b.pname), array_agg(b.ptax))
  from (select * from b order by b.created_at, b.id) b)`;

// Dòng hàng trỏ HĐ bằng VỊ TRÍ của HĐ trong `buy` (số nhỏ thay uuid 36 ký tự mỗi dòng — Luật 4c: bớt ~⅓ chữ JSON phải gửi + đọc).
const itemsJson = sql`(select json_build_array(array_agg(i.ix), array_agg(i.code), array_agg(i.name),
    array_agg(i.spec), array_agg(i.unit), array_agg(i.qty), array_agg(i.unit_price), array_agg(i.vat_rate),
    array_agg(i.valid_from), array_agg(i.valid_to))
  from (select bx.ix, i.* from contracts.contract_items i
    join (select b.id, (row_number() over (order by b.created_at, b.id))::int - 1 as ix from b) bx on bx.id = i.contract_id
    where i.tenant_id = (select t from p) order by bx.ix, i.ord) i)`;

const configsJson = sql`coalesce((select json_agg(json_build_object('role', s.role, 'version', s.version,
      'criteria', s.criteria, 'rules', s.rules, 'updated_by', contracts.user_label(s.updated_by),
      'updated_at', s.updated_at)) from contracts.score_configs s where s.tenant_id = (select t from p)), '[]'::json)`;
const quotesJson = sql`coalesce((select json_agg(json_build_object('id', q.id, 'product_key', q.product_key,
      'product_name', q.product_name, 'unit', q.unit, 'supplier_name', q.supplier_name,
      'supplier_party_key', q.supplier_party_key, 'price', q.price, 'quoted_at', q.quoted_at, 'source', q.source,
      'url', q.url, 'verified', q.verified) order by q.quoted_at, q.created_at, q.id)
    from contracts.price_quotes q where q.tenant_id = (select t from p)), '[]'::json)`;
const namesJson = sql`coalesce((select json_agg(json_build_array(co.party_key, coalesce(nullif(co.short_name, ''), co.name)))
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
  items: Cols<[number, S, string, S, S, N, N, N, S, S]>;
  groups: GroupRow[];
  pend: PendRow[];
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

function itemsBy(c: Raw["items"]): Map<number, PriceItem[]> {
  const out = new Map<number, PriceItem[]>();
  const [cid, code, name, spec, unit, qty, price, vat, from, to] = colsOf(c) as unknown as [
    number[],
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
    const a = out.get(cid[i] as number);
    if (a) a.push(it);
    else out.set(cid[i] as number, [it]);
  }
  return out;
}

const day = (v: S | undefined) => (v && isIsoDate(v) ? v : null);

function buyOf(c: Raw["buy"], items: Map<number, PriceItem[]>): PricedContract[] {
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
    items: items.get(i) ?? [],
  }));
}

/** (đối tác, vai, loại, [số dòng, đúng hạn, ngày trễ, chỉnh tay] cũ, [như vậy] gần đây, điểm gia hạn CKS). */
type GroupRow = [string, Role, string, ...number[]];
type PendRow = [string, Role, number, number, number, number];
type RatedRow = [string, Role, string, number, string, S];

/** Một hàng nhóm SQL ⇒ `addGroup` cho từng nửa có dòng (cũ, gần đây) + gia hạn CKS (≡ `addEvent`: mỗi dòng `cks_*` +1, + `renewValue`). */
function addRow(a: Agg, row: GroupRow): void {
  const [, role, type, ...v] = row;
  const [n0, on0, dl0, d0, n1, on1, dl1, d1, rv] = v.map(Number) as number[];
  if (n0)
    addGroup(a, { type, nw: false, n: n0, on: on0 ?? 0, late: dl0 ?? 0, delta: d0 ?? 0 }, role);
  if (n1)
    addGroup(a, { type, nw: true, n: n1, on: on1 ?? 0, late: dl1 ?? 0, delta: d1 ?? 0 }, role);
  if (type === "cks_renewed" || type === "cks_lapsed") {
    a.renew_n += (n0 ?? 0) + (n1 ?? 0);
    a.renew_sum += rv ?? 0;
  }
}

/** Nhóm SQL ⇒ `Agg` mỗi (đối tác, vai) — `addGroup` (≡ `aggregate`), gia hạn CKS, quá hạn treo, chấm tay mới nhất. */
function aggsOf(r: Pick<Raw, "groups" | "pend" | "rated">): Map<string, Agg> {
  const out = new Map<string, Agg>();
  const at = (party: string, role: Role) => {
    const key = aggKey(party, role);
    const a = out.get(key) ?? emptyAgg();
    out.set(key, a);
    return a;
  };
  for (const row of r.groups) addRow(at(row[0], row[1]), row);
  for (const [party, role, p0n, p0l, p1n, p1l] of r.pend) {
    const a = at(party, role);
    a.pend = [
      { n: Number(p0n), on: 0, late: Number(p0l) },
      { n: Number(p1n), on: 0, late: Number(p1l) },
    ];
  }
  for (const [party, role, cr, v, d, by] of r.rated)
    at(party, role).rated[cr] = { value: v, at: d, by };
  return out;
}
/** Cột ⇒ hình miền. */
function toData(r: Omit<Raw, "buy" | "items"> & { contracts: PricedContract[] }): PartnerData {
  return {
    facts: r.facts.map(([role, name, tax, n, first_start]) => ({
      role,
      name,
      tax,
      party: partyKey(name, tax),
      n,
      first_start: day(first_start),
    })),
    contracts: r.contracts,
    aggs: aggsOf(r),
    configs: r.configs,
    quotes: r.quotes,
    names: new Map(r.names),
    market: new Map(r.market.map(([k, min, max, seen, n]) => [k, { min, max, seen, n }])),
  };
}

const BOTH: readonly Role[] = ["customer", "supplier"];

/**
 * Ba câu ĐỘC LẬP (Luật 4c: chạy song song ở ba tx chỉ đọc, độ trễ = câu chậm nhất; số câu cố định 3): (A) sổ đối tác đã gom +
 * chấm tay mới nhất; (B) sự thật HĐ + cấu hình + danh bạ + giá thị trường; (C) HĐ mua + dòng hàng + báo giá.
 */
/** `roles`: vai cần chấm (vd so giá chỉ cần NCC, danh sách mặt hàng không cần điểm ⇒ `[]`) — dòng vai khác không đọc. */
export type LedgerWindow = { today: string; ov?: WindowOverride; roles?: readonly Role[] };
export const partnerLedger = (tx: Tx, t: string, { today, ov = {}, roles = BOTH }: LedgerWindow) =>
  one<Pick<Raw, "groups" | "pend" | "rated">>(
    tx,
    sql`with p as (select ${t}::uuid as t), ${winCtes(today, ov, roles)}
    select json_build_object('groups', ${groupsJson(today)}, 'pend', ${pendJson(today)},
      'rated', ${ratedJson(today)}) as j`,
  );
export const partnerFacts = (tx: Tx, t: string, today: string) =>
  one<Pick<Raw, "facts" | "configs" | "names" | "market">>(
    tx,
    sql`with p as (select ${t}::uuid as t)
    select json_build_object('facts', ${factsJson}, 'configs', ${configsJson}, 'names', ${namesJson},
      'market', ${marketJson(today)}) as j`,
  );
/** (C) đổi sang hình miền NGAY khi câu xong — chạy chồng lúc còn chờ câu (A) (Luật 4c: bớt việc trên đường găng). */
export async function partnerPrices(
  tx: Tx,
  t: string,
): Promise<{ contracts: PricedContract[]; quotes: Quote[] }> {
  const r = await one<Pick<Raw, "buy" | "items" | "quotes">>(
    tx,
    sql`with p as (select ${t}::uuid as t), ${bCte}
    select json_build_object('buy', ${buyJson}, 'items', ${itemsJson}, 'quotes', ${quotesJson}) as j`,
  );
  return { contracts: buyOf(r.buy, itemsBy(r.items)), quotes: r.quotes };
}
export type PartnerParts = [
  Awaited<ReturnType<typeof partnerLedger>>,
  Awaited<ReturnType<typeof partnerFacts>>,
  Awaited<ReturnType<typeof partnerPrices>>,
];
/** Ghép ba phần ⇒ hình miền. */
export const partnerDataOf = ([a, b, c]: PartnerParts): PartnerData => toData({ ...a, ...b, ...c });

/** Ba phần trong MỘT tx (test parity, lưu cấu hình). */
export async function partnerData(
  tx: Tx,
  t: string,
  today: string,
  ov: WindowOverride = {},
): Promise<PartnerData> {
  return partnerDataOf([
    await partnerLedger(tx, t, { today, ov }),
    await partnerFacts(tx, t, today),
    await partnerPrices(tx, t),
  ]);
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
