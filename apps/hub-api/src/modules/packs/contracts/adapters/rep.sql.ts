// V2-E · BA v2 §5.1 · Luật 4c: MỘT câu gom mọi thứ để chấm uy tín v2 (theo tập, văn bản cố định, cấu hình ô qua MỘT tham số JSON):
// mốc đã xác nhận + việc ghi tay trong khoảng tính của ô, gom theo (đối tác, ô, nguồn) với Σh và Σh·điểm việc (h = bậc thang độ cũ,
// tính ngay ở SQL); giá trị HĐ đã xác nhận theo ô (trọng số điểm vai + danh sách đối tác); sao TB (lượt mới nhất mỗi người); tên danh
// bạ. Ô của HĐ là cột lưu sẵn `rep_cell` (0028) ⇒ tham số ô tra bằng chỉ số mảng, không nối bảng cấu hình (ước lượng đúng ⇒ hash
// join + hash aggregate). Kết quả dạng CỘT. Chạy dưới RLS người gọi (M1: thấy gì chấm nấy) hoặc phạm vi hệ thống (chốt tháng).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { DetailJob, DetailMilestone, ScoreRows } from "../application/reputation.ports";
import { type CellParam, REP_CELLS, type RepGroup, type RepRole } from "../domain/rep-config.rules";
import { type CellInput, monthsBefore, type SrcAgg } from "../domain/rep-score.rules";
import { CONFIRMED_STATUSES, json, one } from "./ledger-sql";

/** Chỉ số ô (1-based, ≡ `contracts.v2e_cell`) ⇒ (nhóm, vai). */
export const cellAt = (k: number) => REP_CELLS[k - 1] as readonly [RepGroup, RepRole];
export const cellIndex = (g: RepGroup, r: RepRole): number =>
  REP_CELLS.findIndex(([a, b]) => a === g && b === r) + 1;

/** Tham số ô gửi xuống SQL: mỗi mảng 5 phần tử theo chỉ số ô (ô không chấm ⇒ null). Ranh giới bậc là NGÀY (hôm nay − m tháng). */
type Arrs = {
  cells: number[];
  lo: (string | null)[];
  b1: (string | null)[];
  b2: (string | null)[];
  b3: (string | null)[];
  f1: (number | null)[];
  f2: (number | null)[];
  f3: (number | null)[];
  f4: (number | null)[];
  lpd: (number | null)[];
  lomin: string;
};

export type { CellParam };

function arrsOf(today: string, cells: CellParam[]): Arrs {
  const nul = <T>(): (T | null)[] => Array<T | null>(REP_CELLS.length).fill(null);
  const a: Arrs = {
    cells: [],
    lomin: today,
    lo: nul(),
    b1: nul(),
    b2: nul(),
    b3: nul(),
    f1: nul(),
    f2: nul(),
    f3: nul(),
    f4: nul(),
    lpd: nul(),
  };
  const bound = (m: number | undefined) => (m ? monthsBefore(today, m) : null);
  for (const c of cells) {
    const i = cellIndex(c.grp, c.role) - 1;
    const lo = monthsBefore(today, c.cfg.window_months);
    const { months: m, factors: f } = c.cfg.decay;
    a.cells.push(i + 1);
    a.lo[i] = lo;
    if (lo < a.lomin) a.lomin = lo;
    a.b1[i] = bound(m[0]);
    a.b2[i] = bound(m[1]);
    a.b3[i] = bound(m[2]);
    a.f1[i] = f[0] ?? null;
    a.f2[i] = f[1] ?? null;
    a.f3[i] = f[2] ?? null;
    a.f4[i] = f[3] ?? null;
    a.lpd[i] = c.cfg.late_per_day;
  }
  return a;
}

const CONFIRMED = sql.raw(CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", "));
const SCORED = sql.raw(`'delivery', 'payment', 'serial', 'commission'`);
/** Hệ số h của ngày `at` theo hàng ô `x` (cột vô hướng b1..b3, f1..f4): tuổi < m tháng ⟺ `at` > hôm nay − m tháng. */
const H = (at: string, x: string) =>
  sql.raw(`(case when ${x}.b1 is null or ${at} > ${x}.b1 then ${x}.f1 when ${x}.b2 is null or ${at} > ${x}.b2 then ${x}.f2
    when ${x}.b3 is null or ${at} > ${x}.b3 then ${x}.f3 else ${x}.f4 end)`);
/** Ô của dòng sổ / lượt chấm (nhóm, vai) — ≡ `contracts.v2e_cell`. */
const CELL_OF = (g: string, r: string) =>
  sql.raw(`(case ${r} when 'supplier' then (case ${g} when 'service' then 1 when 'goods' then 3 end)
    when 'customer' then (case ${g} when 'service' then 2 when 'goods' then 4 end)
    when 'commission_payer' then (case when ${g} = 'referral' then 5 end) end)`);

/**
 * `p` = tham số; `ck` = MỘT hàng mỗi ô đang chấm với tham số vô hướng (≤ 5 hàng); `cc` = HĐ của tenant thuộc ô đang chấm kèm tham số
 * ô (mỗi HĐ một lần — RLS HĐ chạy một lần mỗi HĐ, không mỗi mốc). Mốc / việc / lượt chấm nối `cc`/`ck` bằng hash join.
 */
const base = (t: string, today: string, cells: CellParam[]) =>
  sql`p as (select ${t}::uuid as t, ${today}::date as d, x.* from jsonb_to_record(${json(arrsOf(today, cells))}) as x
    (cells int[], lo date[], b1 date[], b2 date[], b3 date[], f1 float8[], f2 float8[], f3 float8[], f4 float8[],
     lpd float8[], lomin date)),
  ck as materialized (select k, p.lo[k] as lo, p.b1[k] as b1, p.b2[k] as b2, p.b3[k] as b3, p.f1[k] as f1, p.f2[k] as f2,
      p.f3[k] as f3, p.f4[k] as f4, p.lpd[k] as lpd
    from p, unnest(p.cells) k)`;

/** Tenant, hôm nay, đầu khoảng tính sớm nhất — tham số THẲNG (không qua CTE) để planner ước lượng đúng phạm vi ngày (Luật 4c). */
type Win = { t: string; d: string; lo: string };

/** `party`: một đối tác (chi tiết, lịch sử) hoặc null (mọi đối tác). Hai văn bản cố định. */
const only = (col: string, party: string | null): SQL =>
  party === null ? sql`` : sql` and ${sql.raw(col)} = ${party}::text`;

// Luật 4c: mỗi nguồn được CHIẾU HẸP trước (h, h·điểm tính một lần; `materialized` ⇒ hàng gom chỉ mang 5 cột, không mang `fields`
// jsonb / tham số qua bước gom).
/** Mốc đã xác nhận + việc ghi tay chưa huỷ, mỗi nguồn gom riêng rồi nối. */
const aggCte = (party: string | null, w: Win) => sql`ms0 as materialized (
    select o.party_key as party, ck.k as cell,
      case when o.owner = 'partner' and o.kind in (${SCORED}) then 'm:' || o.kind else 'tx' end as src,
      x.h, x.h * (case when o.fault = 'partner'
        then greatest(0, 100 - ck.lpd * greatest(0, o.done_at - o.due_date)) else 100 end) as hs
    from contracts.obligations o
    -- Ô chép sẵn trên mốc (rep_cell, 0028): MỘT lần quét mốc trong khoảng + nối bảng 5 ô — không nối / dò 3.000 HĐ.
    join ck on ck.k = o.rep_cell
    cross join lateral (select ${H("o.done_at", "ck")}::float8 as h) x
    where o.tenant_id = ${w.t}::uuid and o.status = 'done' and o.party_key is not null and o.done_at > ${w.lo}::date
      and o.done_at <= ${w.d}::date and o.done_at > ck.lo${only("o.party_key", party)}),
  jb0 as materialized (
    select e.party_key as party, ck.k as cell, 'j:' || e.job_type as src, ${H("e.at", "ck")}::float8 as h, 0::float8 as hs
    from p, contracts.partner_events e join ck on ck.k = ${CELL_OF("e.grp", "e.role")}
    where e.tenant_id = ${w.t}::uuid and e.type = 'job' and e.at > ${w.lo}::date and e.at <= ${w.d}::date and e.at > ck.lo${only("e.party_key", party)}
      and not exists (select 1 from contracts.partner_event_voids v where v.tenant_id = e.tenant_id and v.event_id = e.id)),
  ag as (
    select u.party collate "C" as party, u.cell, u.src collate "C" as src, count(*)::int as n, sum(u.h)::float8 as wh,
      sum(u.hs)::float8 as whs
    from (select * from ms0 union all select * from jb0) u group by 1, 2, 3)`;

/** HĐ đã xác nhận theo ô: khoá đối tác lưu sẵn (`partner_key`), tên bên kia, giá trị trong khoảng tính. */
const cvCte = (party: string | null, w: Win) => sql`cv0 as materialized (
    select c.partner_key as party, ck.k as cell,
      c.fields -> (case when c.direction = 'sale' then 'buyer_name' else 'supplier_name' end) ->> 'value' as name,
      case when coalesce(c.start_date, c.created_at::date) <= ck.lo then 0
        when jsonb_typeof(c.fields -> 'total_value' -> 'value') = 'number' then (c.fields -> 'total_value' ->> 'value')::float8
        when (c.fields -> 'total_value' ->> 'value') ~ '^[0-9]{1,16}(\\.[0-9]+)?$'
          then (c.fields -> 'total_value' ->> 'value')::float8 else 0 end as v
    from p, contracts.contracts c join ck on ck.k = c.rep_cell
    where c.tenant_id = ${w.t}::uuid and c.kind = 'contract' and c.status in (${CONFIRMED})
      and c.partner_key is not null${only("c.partner_key", party)}),
  cv as (select v.party collate "C" as party, v.cell, min(v.name) as name, sum(v.v)::float8 as value from cv0 v group by 1, 2)`;

const rtCte = (party: string | null) => sql`rt as (
    select r.party collate "C" as party, r.cell, r.criterion collate "C" as criterion, avg(r.stars)::float8 as avg
    from (select distinct on (r.party_key, r.role, r.grp, r.criterion, r.by_user) r.party_key as party, ck.k as cell,
        r.criterion, r.stars
      from p, contracts.score_ratings r join ck on ck.k = ${CELL_OF("r.grp", "r.role")}
      where r.tenant_id = p.t and r.at >= ck.lo::timestamptz and r.at < (p.d + 1)::timestamptz${only("r.party_key", party)}
      order by r.party_key, r.role, r.grp, r.criterion, r.by_user, r.at desc, r.id desc) r
    group by 1, 2, 3)`;

const cols = (from: string, c: string[]) =>
  sql.raw(`(select json_build_array(${c.map((x) => `array_agg(${x})`).join(", ")}) from ${from})`);

type Col<T> = T[] | null;
type Raw = {
  ag: [Col<string>, Col<number>, Col<string>, Col<number>, Col<number>, Col<number>];
  cv: [Col<string>, Col<number>, Col<string | null>, Col<number>];
  rt: [Col<string>, Col<number>, Col<string>, Col<number>];
  nm: [Col<string>, Col<string>];
};

export type { DetailJob, DetailMilestone, ScoreRows };

function inputsOf(r: Raw): Map<string, CellInput> {
  const out = new Map<string, CellInput>();
  const at = (party: string, k: number) => {
    const key = `${party}\u0001${k}`;
    let x = out.get(key);
    if (!x) {
      const [grp, role] = cellAt(k);
      x = { party, role, grp, sources: {}, value: 0, stars: {} };
      out.set(key, x);
    }
    return x;
  };
  const [cp, ck, , cvv] = r.cv;
  (cp ?? []).forEach((p, i) => {
    at(p, ck?.[i] as number).value = Number(cvv?.[i] ?? 0);
  });
  const [ap, ak, as, an, aw, ash] = r.ag;
  (ap ?? []).forEach((p, i) => {
    const s: SrcAgg = { n: Number(an?.[i]), wh: Number(aw?.[i]), whs: Number(ash?.[i] ?? 0) };
    at(p, ak?.[i] as number).sources[as?.[i] as string] = s;
  });
  const [rp, rk, rc, ra] = r.rt;
  (rp ?? []).forEach((p, i) => {
    at(p, rk?.[i] as number).stars[rc?.[i] as string] = Number(ra?.[i]);
  });
  return out;
}

function namesOf(r: Raw): Map<string, string> {
  const names = new Map<string, string>();
  const [cp, , cn] = r.cv;
  (cp ?? []).forEach((p, i) => {
    const n = cn?.[i];
    if (n && !names.has(p)) names.set(p, n);
  });
  const [np, nn] = r.nm;
  (np ?? []).forEach((p, i) => {
    names.set(p, nn?.[i] as string);
  });
  return names;
}

export type AggPart = Pick<Raw, "ag">;
export type FactPart = Omit<Raw, "ag">;
/** Câu (A): việc đã gom theo (đối tác, ô, nguồn) — mốc + việc ghi tay. */
/** Câu chấm: ngày tính, các ô, một đối tác (null ⇒ tất cả). */
export type RepQuery = { today: string; cells: CellParam[]; party: string | null };
export const aggRows = (tx: Tx, t: string, { today, cells, party }: RepQuery) =>
  one<AggPart>(
    tx,
    sql`with ${base(t, today, cells)}, ${aggCte(party, { t, d: today, lo: arrsOf(today, cells).lomin })}
    select json_build_object('ag', ${cols("ag", ["party", "cell", "src", "n", "wh", "whs"])}) as j`,
  );
/** Câu (B): HĐ theo ô (giá trị, tên) + sao TB + danh bạ. */
export const factRows = (tx: Tx, t: string, { today, cells, party }: RepQuery) =>
  one<FactPart>(
    tx,
    sql`with ${base(t, today, cells)}, ${cvCte(party, { t, d: today, lo: arrsOf(today, cells).lomin })}, ${rtCte(party)},
      nm as (select co.party_key, coalesce(nullif(co.short_name, ''), co.name) as name from p, contracts.companies co
        where co.tenant_id = p.t and coalesce(nullif(co.short_name, ''), co.name) is not null${only("co.party_key", party)})
    select json_build_object('cv', ${cols("cv", ["party", "cell", "name", "value"])},
      'rt', ${cols("rt", ["party", "cell", "criterion", "avg"])}, 'nm', ${cols("nm", ["party_key", "name"])}) as j`,
  );
/** Ghép hai phần ⇒ đầu vào chấm. */
export const rowsOf = (a: AggPart, f: FactPart): ScoreRows => {
  const r: Raw = { ...a, ...f };
  return { inputs: inputsOf(r), names: namesOf(r) };
};

/**
 * Hai câu ĐỘC LẬP (A) + (B) trong MỘT tx (vòng chốt tháng). Đường đọc HTTP chạy chúng song song ở hai tx (`reputation.usecase.ts`,
 * Luật 4c: độ trễ = câu chậm nhất).
 */
export async function scoreRows(tx: Tx, t: string, q: RepQuery): Promise<ScoreRows> {
  const a = await aggRows(tx, t, q);
  return rowsOf(a, await factRows(tx, t, q));
}

/** DT-02: từng việc góp điểm của MỘT đối tác × vai trong khoảng tính (mốc việc của đối tác + việc ghi tay; ≤ 500 mỗi loại). */
export async function detailRows(
  tx: Tx,
  t: string,
  { today, cells, party }: RepQuery & { party: string },
) {
  const r = await one<{ ms: (Omit<DetailMilestone, "grp"> & { cell: number })[]; jb: DetailJob[] }>(
    tx,
    sql`with ${base(t, today, cells)}
    select json_build_object(
      'ms', coalesce((select json_agg(x order by x.done_at desc, x.id) from (
        select o.id, c.rep_cell as cell, o.kind, o.title, o.contract_id, c.title as contract, o.due_date, o.done_at, o.fault
        from p, contracts.obligations o
        join contracts.contracts c on c.tenant_id = o.tenant_id and c.id = o.contract_id
        where o.tenant_id = p.t and o.status = 'done' and o.party_key = ${party}::text and o.owner = 'partner'
          and o.kind in (${SCORED}) and c.rep_cell = any (p.cells) and o.done_at > p.lo[c.rep_cell] and o.done_at <= p.d
        order by o.done_at desc, o.id limit 500) x), '[]'::json),
      'jb', coalesce((select json_agg(x order by x.at desc, x.id) from (
        select e.id::text as id, e.grp, e.job_type, e.at, e.note, e.contract_id
        from p, contracts.partner_events e cross join lateral (select ${CELL_OF("e.grp", "e.role")} as k) k
        where e.tenant_id = p.t and e.type = 'job' and e.party_key = ${party}::text and k.k = any (p.cells)
          and e.at > p.lo[k.k] and e.at <= p.d
          and not exists (select 1 from contracts.partner_event_voids v where v.tenant_id = e.tenant_id and v.event_id = e.id)
        order by e.at desc, e.id limit 500) x), '[]'::json)) as j`,
  );
  const ms: DetailMilestone[] = r.ms.map(({ cell, ...m }) => ({ ...m, grp: cellAt(cell)[0] }));
  return { ms, jb: r.jb };
}
