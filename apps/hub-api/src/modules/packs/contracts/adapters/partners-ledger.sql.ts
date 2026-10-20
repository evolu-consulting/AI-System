// HD8-FR-02 · HD8-NFR-01: mảnh SQL gom sổ đối tác theo (đối tác, vai) cho `partners-data.repo.ts` (câu A). Dùng CTE `p` (tenant) của
// câu gọi. Văn bản cố định; dữ liệu qua tham số, ngày máy chủ kiểm dạng trước khi vào chữ.
import { sql } from "drizzle-orm";

/**
 * HD8-NFR-01: sổ đối tác GOM ở SQL theo (đối tác, vai) — ≡ `aggregate()` (scoring-agg.rules.ts), test parity ngẫu nhiên
 * `HD8/agg-parity.int.test.ts`. Khoảng tính theo vai: `round(m·30,44)` với m nguyên không bao giờ rơi đúng .5 ⇒ làm tròn SQL ≡
 * Python; `ov` = khoảng của bản nháp (xem trước/lưu) đè cấu hình đã lưu. Dòng đã huỷ bị bỏ (engine bỏ qua).
 */
export const winCtes = (today: string, ov: unknown, roles: readonly string[]) => sql`rw0 as (
    select x.role,
      ${today}::date - round(coalesce((${JSON.stringify(ov ?? {})}::jsonb -> x.role ->> 'window_months')::int,
        (s.rules ->> 'window_months')::int, 12) * 30.44)::int as st,
      ${today}::date - round(coalesce((${JSON.stringify(ov ?? {})}::jsonb -> x.role ->> 'recency_months')::int,
        (s.rules ->> 'recency_months')::int, 3) * 30.44)::int as rc
    from (values ('customer'), ('supplier')) x (role)
    left join contracts.score_configs s on s.tenant_id = (select t from p) and s.role = x.role),
  rw as (select max(st) filter (where role = 'customer') as cs, max(rc) filter (where role = 'customer') as cr,
      max(st) filter (where role = 'supplier') as ss, max(rc) filter (where role = 'supplier') as sr,
      string_to_array(${roles.join(",")}::text, ',') as roles from rw0)`;

/** Quét sổ trong khoảng tính của vai, bỏ dòng đã huỷ — mỗi tập con quét riêng (không vật chất hoá 10.000 dòng một CTE chung). */
/** `today` = ngày lịch máy chủ tính (`localDate`) — kiểm dạng trước khi đặt vào chữ SQL. */
const day0 = (today: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`bad day ${today}`);
  return today;
};
const scanText = (e: string, today: string) =>
  `from contracts.partner_events ${e}
    where ${e}.tenant_id = (select t from p) and ${e}.at <= '${day0(today)}'::date
      and ${e}.role = any((select roles from rw)::text[])
      and ${e}.at >= case when ${e}.role = 'customer' then (select cs from rw) else (select ss from rw) end
      and ${e}.id not in (select v.event_id from contracts.partner_event_voids v where v.tenant_id = (select t from p))`;
const scan = (e: string, today: string) => sql.raw(scanText(e, today));
const nw = (e: string) =>
  sql.raw(
    `(${e}.at >= case when ${e}.role = 'customer' then (select cr from rw) else (select sr from rw) end)`,
  );

/**
 * Đếm theo (đối tác, vai, loại, gần đây): số dòng, số đúng hạn, tổng ngày trễ, tổng chỉnh tay, tổng điểm gia hạn CKS (`renewValue`:
 * mất/không qua mình 0; đúng hạn 100; trễ −10/ngày; chỉ tính ở `cks_*`) — TS cộng lại thành `Agg`, gia hạn = cộng các nhóm `cks_*`.
 * Luật 4c: hai nhóm cũ/gần đây là cột `filter` của CÙNG một nhóm (loại, đối tác, vai) — khớp thứ tự chỉ mục
 * `partner_events_type_idx`, không sắp xếp lại 10.000 dòng. Loại phổ biến (thanh toán, giao, nhắc…) chỉ cần đếm + ngày trễ; loại
 * hiếm cần đọc `data` (chỉnh tay, gia hạn CKS) đi lượt riêng qua chỉ mục loại — lượt lớn bớt biểu thức mỗi dòng.
 */
const RARE = sql.raw(`('manual_adjust', 'cks_renewed', 'cks_lapsed')`);
export const groupsJson = (
  today: string,
) => sql`coalesce((select json_agg(json_build_array(g.party_key, g.role, g.type, g.n0, g.on0, g.dl0, g.d0,
    g.n1, g.on1, g.dl1, g.d1, g.rv)) from (
    select x.party_key, x.role, x.type,
      count(*) filter (where not x.nw) as n0, count(*) filter (where not x.nw and x.late = 0) as on0,
      coalesce(sum(x.late) filter (where not x.nw), 0) as dl0, 0 as d0,
      count(*) filter (where x.nw) as n1, count(*) filter (where x.nw and x.late = 0) as on1,
      coalesce(sum(x.late) filter (where x.nw), 0) as dl1, 0 as d1, 0 as rv
    from (select e.party_key, e.role, e.type, ${nw("e")} as nw, coalesce(e.days_late, 0) as late
      ${scan("e", today)} and e.type not in ('rating', 'overdue') and e.type not in ${RARE}) x
    group by x.type, x.party_key, x.role
    union all
    select x.party_key, x.role, x.type,
      count(*) filter (where not x.nw), count(*) filter (where not x.nw and x.late = 0),
      coalesce(sum(x.late) filter (where not x.nw), 0), coalesce(sum(x.delta) filter (where not x.nw), 0),
      count(*) filter (where x.nw), count(*) filter (where x.nw and x.late = 0),
      coalesce(sum(x.late) filter (where x.nw), 0), coalesce(sum(x.delta) filter (where x.nw), 0), coalesce(sum(x.rv), 0)
    from (select e.party_key, e.role, e.type, ${nw("e")} as nw, coalesce(e.days_late, 0) as late,
        case when e.type = 'manual_adjust' then coalesce((e.data ->> 'delta')::int, 0) else 0 end as delta,
        case when e.type not in ('cks_renewed', 'cks_lapsed') then 0
          when e.type = 'cks_lapsed' or (e.data ? 'with_us' and coalesce(e.data ->> 'with_us', '') in ('false', '', '0')) then 0
          when coalesce((e.data ->> 'days_before_expiry')::int, 0) >= 0 then 100
          else greatest(0, 100 + 10 * (e.data ->> 'days_before_expiry')::int) end as rv
      ${scan("e", today)} and e.type in ${RARE}) x
    group by x.type, x.party_key, x.role) g), '[]'::json)`;
/**
 * "Đã trả lời" dòng quá hạn `o`: có dòng (trong khoảng, chưa huỷ) cùng đối tác + vai + mã đợt (null khớp null như `in` của Python)
 * là thanh toán/giao, hoặc hoãn có `at` ≥ dòng quá hạn. MỘT `exists` (một lần mở policy M1) thay bốn — cùng nghĩa.
 */
const answered = (today: string) =>
  sql.raw(`exists (select 1 ${scanText("s", today)} and s.party_key = o.party_key and s.role = o.role
      and s.obligation_id is not distinct from o.obligation_id
      and (s.type in ('paid', 'received', 'delivered') or (s.type = 'postponed' and s.at >= o.at)))`);

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
        and not ${answered(today)}) d
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
