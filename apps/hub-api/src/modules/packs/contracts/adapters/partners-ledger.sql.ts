// HD8-FR-02 · HD8-NFR-01: mảnh SQL gom sổ đối tác theo (đối tác, vai) cho `partners-data.repo.ts` (câu A). Dùng CTE `p` (tenant) của
// câu gọi. Văn bản cố định; dữ liệu qua tham số, ngày máy chủ kiểm dạng trước khi vào chữ.
import { sql } from "drizzle-orm";

/**
 * HD8-NFR-01: sổ đối tác GOM ở SQL theo (đối tác, vai) — ≡ `aggregate()` (scoring-agg.rules.ts), test parity ngẫu nhiên
 * `HD8/agg-parity.int.test.ts`. Khoảng tính theo vai: `round(m·30,44)` với m nguyên không bao giờ rơi đúng .5 ⇒ làm tròn SQL ≡
 * Python; `ov` = khoảng của bản nháp (xem trước/lưu) đè cấu hình đã lưu. Dòng đã huỷ bị bỏ (engine bỏ qua).
 */
export const winCtes = (today: string, ov: unknown) => sql`rw0 as (
    select x.role,
      ${today}::date - round(coalesce((${JSON.stringify(ov ?? {})}::jsonb -> x.role ->> 'window_months')::int,
        (s.rules ->> 'window_months')::int, 12) * 30.44)::int as st,
      ${today}::date - round(coalesce((${JSON.stringify(ov ?? {})}::jsonb -> x.role ->> 'recency_months')::int,
        (s.rules ->> 'recency_months')::int, 3) * 30.44)::int as rc
    from (values ('customer'), ('supplier')) x (role)
    left join contracts.score_configs s on s.tenant_id = (select t from p) and s.role = x.role),
  rw as (select max(st) filter (where role = 'customer') as cs, max(rc) filter (where role = 'customer') as cr,
      max(st) filter (where role = 'supplier') as ss, max(rc) filter (where role = 'supplier') as sr from rw0)`;

/** Quét sổ trong khoảng tính của vai, bỏ dòng đã huỷ — mỗi tập con quét riêng (không vật chất hoá 10.000 dòng một CTE chung). */
/** `today` = ngày lịch máy chủ tính (`localDate`) — kiểm dạng trước khi đặt vào chữ SQL. */
const day0 = (today: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`bad day ${today}`);
  return today;
};
const scanText = (e: string, today: string) =>
  `from contracts.partner_events ${e} cross join rw
    where ${e}.tenant_id = (select t from p) and ${e}.at <= '${day0(today)}'::date
      and ${e}.at >= case when ${e}.role = 'customer' then rw.cs else rw.ss end
      and ${e}.id not in (select v.event_id from contracts.partner_event_voids v where v.tenant_id = (select t from p))`;
const scan = (e: string, today: string) => sql.raw(scanText(e, today));
const nw = (e: string) =>
  sql.raw(`(${e}.at >= case when ${e}.role = 'customer' then rw.cr else rw.sr end)`);

/** Đếm theo (đối tác, vai, loại, gần đây): số dòng, số đúng hạn, tổng ngày trễ, tổng chỉnh tay — TS cộng lại thành `Agg`. */
export const groupsJson = (
  today: string,
) => sql`coalesce((select json_agg(json_build_array(g.party_key, g.role, g.type, g.nw, g.n,
    g.n_on, g.dl, g.delta)) from (
    select e.party_key, e.role, e.type, ${nw("e")} as nw, count(*) as n,
      count(*) filter (where coalesce(e.days_late, 0) = 0) as n_on, sum(coalesce(e.days_late, 0)) as dl,
      coalesce(sum(coalesce((e.data ->> 'delta')::int, 0)) filter (where e.type = 'manual_adjust'), 0) as delta
    ${scan("e", today)} and e.type not in ('rating', 'overdue') group by 1, 2, 3, 4) g), '[]'::json)`;

/** Gia hạn CKS: số lần + tổng điểm mỗi lần (`renewValue`: mất/không qua mình 0; đúng hạn 100; trễ −10/ngày). */
export const renewJson = (
  today: string,
) => sql`coalesce((select json_agg(json_build_array(r.party_key, r.role, r.n, r.v)) from (
    select e.party_key, e.role, count(*) as n, sum(case
        when e.type = 'cks_lapsed' or (e.data ? 'with_us' and coalesce(e.data ->> 'with_us', '') in ('false', '', '0')) then 0
        when coalesce((e.data ->> 'days_before_expiry')::int, 0) >= 0 then 100
        else greatest(0, 100 + 10 * (e.data ->> 'days_before_expiry')::int) end) as v
    ${scan("e", today)} and e.type in ('cks_renewed', 'cks_lapsed') group by 1, 2) r), '[]'::json)`;

/** Có dòng (trong khoảng, chưa huỷ) cùng đối tác + vai + mã đợt (null khớp null như `in` của Python) thoả `cond`. */
const sameOb = (today: string, cond: string) =>
  sql.raw(`((o.obligation_id is not null and exists (select 1 ${scanText("s", today)} and s.party_key = o.party_key
      and s.role = o.role and s.obligation_id = o.obligation_id and ${cond}))
    or (o.obligation_id is null and exists (select 1 ${scanText("s", today)} and s.party_key = o.party_key
      and s.role = o.role and s.obligation_id is null and ${cond})))`);

/** `_pending_overdue`: dòng "Quá hạn" chưa ai trả lời, đúng loại của vai; trễ = max(1, hôm nay − hạn). */
export const pendJson = (
  today: string,
) => sql`coalesce((select json_agg(json_build_array(x.party_key, x.role, x.p0n, x.p0l, x.p1n, x.p1l)) from (
    select d.party_key, d.role,
      count(*) filter (where not d.nw) as p0n, coalesce(sum(d.dl) filter (where not d.nw), 0) as p0l,
      count(*) filter (where d.nw) as p1n, coalesce(sum(d.dl) filter (where d.nw), 0) as p1l
    from (select o.party_key, o.role, ${nw("o")} as nw,
        greatest(1, ${today}::date - contracts.as_date(o.data ->> 'due_date')) as dl
      ${scan("o", today)} and o.type = 'overdue' and o.data ->> 'party_late' = 'true'
        and (o.role = 'supplier') = coalesce(o.data ->> 'kind' = 'delivery', false)
        and not ${sameOb(today, "s.type in ('paid', 'received', 'delivered')")}
        and not ${sameOb(today, "s.type = 'postponed' and s.at >= o.at")}) d
    group by 1, 2) x), '[]'::json)`;

/** `_rated`: lần chấm mới nhất mỗi (đối tác, vai, tiêu chí) trong khoảng tính — theo (`at`, `rated_at`, id). */
export const ratedJson = (
  today: string,
) => sql`coalesce((select json_agg(json_build_array(r.party_key, r.role, r.cr, r.v, r.at, r.by)) from (
    select distinct on (e.party_key, e.role, e.data ->> 'criterion') e.party_key, e.role, e.data ->> 'criterion' as cr,
      (e.data ->> 'value')::int as v, e.at, contracts.user_label(e.by_user) as by
    ${scan("e", today)} and e.type = 'rating'
    order by e.party_key, e.role, e.data ->> 'criterion', e.at desc,
      coalesce(e.data ->> 'rated_at', '') collate "C" desc, e.id desc) r), '[]'::json)`;
