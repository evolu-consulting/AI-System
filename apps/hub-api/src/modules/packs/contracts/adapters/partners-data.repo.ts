// HD8-FR-01 · HD8-FR-05 · HD8-NFR-01 (Luật 4c): MỘT câu đọc mọi thứ để chấm điểm + so giá, ở phạm vi người dùng (RLS M1/M1b: HĐ
// người dùng thấy; sổ đối tác: mọi dòng của đối tác người dùng thấy ⇒ điểm trên cả sổ của đối tác đó như mgmt, D8-04). Bản đầu (mỗi
// HĐ một object `jsonb` + hàm SQL theo hàng `party_key`/`as_date`/`user_label`, không inline được) tốn 1,4 s trên 10.000 HĐ/dòng sổ.
// Giờ: sự thật HĐ gom ngay trên `contracts` theo (vai, tên, MST) bên đối tác; chỉ HĐ phía mua kèm dòng hàng (giá chỉ cần bên NCC),
// HĐ cha chỉ tra cho phụ lục; sự kiện trong khoảng tính, bỏ dòng đã huỷ, không sắp; mảng `json` gọn; khoá đối tác + ngày ở TS.
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
 * Sổ đối tác trong khoảng tính (`window_start` lớn nhất của hai vai đã lưu, mặc định 12 tháng; `round(m·30,44)` với m nguyên không
 * bao giờ rơi đúng .5 ⇒ làm tròn SQL ≡ Python) tới hôm nay, bỏ dòng đã huỷ (engine bỏ qua cả hai); chấm tay lấy hết (lịch sử
 * chấm). Thứ tự không cần (engine không phụ thuộc thứ tự; chấm tay tự sắp). `data` rỗng gửi null.
 */
const eventsJson = (
  today: string,
  months: number,
) => sql`(select json_build_array(array_agg(e.id::text),
    array_agg(e.party_key), array_agg(e.role), array_agg(e.type), array_agg(e.at), array_agg(e.days_late),
    array_agg(e.obligation_id), array_agg(nullif(e.data, '{}'::jsonb)),
    array_agg(case when e.type = 'rating' then contracts.user_label(e.by_user) end),
    array_agg(case when e.type = 'rating' then e.note end))
  from contracts.partner_events e
  where e.tenant_id = (select t from p)
    and (e.type = 'rating' or e.at between ${today}::date - (select round(greatest(coalesce(max((s.rules ->> 'window_months')::int), 12),
          ${months}::int) * 30.44)::int from contracts.score_configs s where s.tenant_id = (select t from p))
      and ${today}::date)
    and e.id not in (select v.event_id from contracts.partner_event_voids v where v.tenant_id = (select t from p)))`;

const restJson = sql`'configs', coalesce((select json_agg(json_build_object('role', s.role, 'version', s.version,
      'criteria', s.criteria, 'rules', s.rules, 'updated_by', contracts.user_label(s.updated_by),
      'updated_at', s.updated_at)) from contracts.score_configs s where s.tenant_id = (select t from p)), '[]'::json),
  'quotes', coalesce((select json_agg(json_build_object('id', q.id, 'product_key', q.product_key,
      'product_name', q.product_name, 'unit', q.unit, 'supplier_name', q.supplier_name,
      'supplier_party_key', q.supplier_party_key, 'price', q.price, 'quoted_at', q.quoted_at, 'source', q.source,
      'url', q.url) order by q.quoted_at, q.created_at, q.id)
    from contracts.price_quotes q where q.tenant_id = (select t from p)), '[]'::json)`;

type S = string | null;
type N = number | null;
/** Một tập dạng cột: mỗi phần tử là MỘT cột (null khi tập rỗng). */
type Cols<T extends unknown[]> = { [K in keyof T]: T[K][] | null };
type Raw = {
  facts: [Role, S, S, number, S][];
  buy: Cols<[string, "contract" | "appendix", string, S, S, string, S, S, S]>;
  items: Cols<[string, S, string, S, S, N, N, N, S, S]>;
  events: Cols<[string, string, Role, string, string, N, S, object | null, S, S]>;
  configs: StoredConfig[];
  quotes: Quote[];
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

function eventsOf(c: Raw["events"]): PartyEv[] {
  const [id, party, role, type, at, late, ob, data, by, note] = colsOf(c) as unknown as [
    string[],
    string[],
    Role[],
    string[],
    string[],
    N[],
    S[],
    (object | null)[],
    S[],
    S[],
  ];
  return id.map((x, i) => ({
    ...(data[i] ?? {}),
    id: x,
    party: party[i] as string,
    role: role[i] as Role,
    type: type[i] as string,
    at: at[i] as string,
    voided: false,
    days_late: late[i] ?? null,
    obligation_id: ob[i] ?? null,
    by: by[i] ?? null,
    note: note[i] ?? null,
  }));
}

/** Cột ⇒ hình miền (sự kiện trải `data` như mgmt). */
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
    events: eventsOf(r.events),
    configs: r.configs,
    quotes: r.quotes,
  };
}
/** MỘT câu: sự thật HĐ (gom), HĐ mua + dòng hàng, sổ đối tác, cấu hình, báo giá. HĐ CKS gia hạn mất khách không tính (`lost_renewal`). */
export async function partnerData(
  tx: Tx,
  t: string,
  today: string,
  /** Khoảng tính tối thiểu (tháng) — bản nháp xem trước/lưu có thể rộng hơn cấu hình đã lưu. */
  months = 1,
): Promise<PartnerData> {
  const raw = await one<Raw>(
    tx,
    sql`with p as (select ${t}::uuid as t), ${bCte}
    select json_build_object('facts', ${factsJson}, 'buy', ${buyJson}, 'items', ${itemsJson}, 'events', ${eventsJson(today, months)},
      ${restJson}) as j`,
  );
  return toData(raw);
}
