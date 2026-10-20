// W1 · "Việc của tôi" (Luật 4c): MỘT câu SQL văn bản cố định cho cả danh sách (bốn CTE, mỗi nguồn ≤ 101 hàng ⇒ số câu không phụ thuộc
// số hàng), lọc `tenant_id` tường minh ngoài RLS. Hàng của HĐ người dùng KHÔNG thấy (luật thấy M1: RLS RESTRICTIVE trên `contracts`,
// `obligations`, `cks_renewals`) không bao giờ vào kết quả: `obligations` tự lọc theo HĐ; `contracts` lọc trực tiếp; nhắc hạn và hẹn
// nhắc gia hạn nối với bảng đã lọc. "Của tôi" = `app.user_id` của tx (đặt từ token, không bao giờ từ client).
import { MYWORK_SOURCE_MAX } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { MyWorkRepo } from "../application/mywork.usecase";
import type { RawMyWork } from "../domain/mywork.rules";
import { one } from "./ledger-sql";

const ME = sql`NULLIF(current_setting('app.user_id', true), '')::uuid`;
/** Chủ thể dạng uuid (so bằng uuid để dùng PK index thay vì `id::text = …` quét bảng — review B #19). */
const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const LIM = MYWORK_SOURCE_MAX + 1;

export function myWorkRepo(tx: Tx, t: string): MyWorkRepo {
  return {
    list: (w) =>
      one<RawMyWork>(
        tx,
        sql`with ob as (
            select o.id, o.contract_id, o.direction, o.amount, o.due_date from contracts.obligations o
            where o.tenant_id = ${t}::uuid and o.status = 'open' and o.kind = 'payment' and o.due_date <= ${w.horizon}::date
            order by o.due_date, o.id limit ${LIM}::int),
          dl as (
            select c.id, c.action_deadline, c.number, c.title, c.direction, c.seller, c.buyer, c.fields from contracts.contracts c
            where c.tenant_id = ${t}::uuid and c.kind = 'contract' and c.handled is null
              and c.status in ('active', 'expiring', 'expired') and c.action_deadline <= ${w.horizon}::date
              and (c.end_date is null or c.end_date >= ${w.archive}::date)
            order by c.action_deadline, c.id limit ${LIM}::int),
          fu as (
            select f.id, f.due_at, f.note, f.customer_id, f.renewal_id from contracts.cks_followups f
            where f.tenant_id = ${t}::uuid and f.user_id = ${ME} and f.done_at is null
              and f.due_at < ((${w.horizon}::date + 1)::timestamp at time zone ${w.tz}::text)
              and (f.renewal_id is null or exists (select 1 from contracts.cks_renewals rn
                where rn.tenant_id = ${t}::uuid and rn.id = f.renewal_id))
              and (f.customer_id is null or exists (select 1 from contracts.cks_customers cu
                where cu.tenant_id = ${t}::uuid and cu.id = f.customer_id))
            order by f.due_at, f.id limit ${LIM}::int),
          gf as (
            select g.id, g.due_at, g.title, g.note, g.subject_kind, g.contract_id from contracts.followups g
            where g.tenant_id = ${t}::uuid and g.user_id = ${ME} and g.status <> 'done'
              and g.due_at < ((${w.horizon}::date + 1)::timestamp at time zone ${w.tz}::text)
              and case when g.subject_kind <> 'obligation' then true
                when g.subject_id !~ ${UUID_RE} then false
                else exists (select 1 from contracts.obligations o
                  where o.tenant_id = ${t}::uuid and o.id = g.subject_id::uuid and o.status = 'open') end
            order by g.due_at, g.id limit ${LIM}::int),
          rm as (
            select * from (
              select distinct on (r.contract_id) r.id, r.contract_id, r.deadline, r.milestone, c.number, c.title, c.direction,
                c.seller, c.buyer, c.fields
              from contracts.contract_reminders r
              join contracts.contracts c on c.tenant_id = r.tenant_id and c.id = r.contract_id
              where r.tenant_id = ${t}::uuid and r.user_id = ${ME} and r.sent_at >= now() - interval '14 days'
                and r.deadline > ${w.horizon}::date and c.handled is null and c.status in ('active', 'expiring')
                and c.action_deadline = r.deadline
              order by r.contract_id, r.sent_at desc) x
            order by x.deadline, x.id limit ${LIM}::int)
          select jsonb_build_object(
            'obligations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'contract_id', r.contract_id,
                'direction', r.direction, 'amount', r.amount, 'due', r.due_date, 'number', c.number,
                'title', coalesce(nullif(c.fields -> 'title' ->> 'value', ''), c.number, c.title),
                'party', case when c.direction = 'sale' then c.buyer else c.seller end,
                'contract_direction', c.direction) order by r.due_date, r.id)
              from ob r left join contracts.contracts c on c.tenant_id = ${t}::uuid and c.id = r.contract_id), '[]'::jsonb),
            'deadlines', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'deadline', d.action_deadline,
                'number', d.number, 'title', coalesce(nullif(d.fields -> 'title' ->> 'value', ''), d.number, d.title),
                'party', case when d.direction = 'sale' then d.buyer else d.seller end,
                'contract_direction', d.direction) order by d.action_deadline, d.id) from dl d), '[]'::jsonb),
            'reminders', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'contract_id', m.contract_id,
                'deadline', m.deadline, 'milestone', m.milestone, 'number', m.number,
                'title', coalesce(nullif(m.fields -> 'title' ->> 'value', ''), m.number, m.title),
                'party', case when m.direction = 'sale' then m.buyer else m.seller end,
                'contract_direction', m.direction) order by m.deadline, m.id) from rm m), '[]'::jsonb),
            'gfollowups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id,
                'due', (g.due_at at time zone ${w.tz}::text)::date,
                'at', to_char(g.due_at at time zone ${w.tz}::text, 'YYYY-MM-DD"T"HH24:MI'),
                'note', g.note, 'title', g.title, 'subject', g.subject_kind, 'contract_id', g.contract_id)
                order by g.due_at, g.id) from gf g), '[]'::jsonb),
            'followups', coalesce((select jsonb_agg(jsonb_build_object('id', f.id,
                'due', (f.due_at at time zone ${w.tz}::text)::date,
                'at', to_char(f.due_at at time zone ${w.tz}::text, 'YYYY-MM-DD"T"HH24:MI'),
                'note', f.note, 'customer_id', coalesce(f.customer_id, rn.customer_id), 'customer_name', cu.name,
                'subject', case when f.renewal_id is not null then 'renewal' else 'customer' end) order by f.due_at, f.id)
              from fu f
              left join contracts.cks_renewals rn on rn.tenant_id = ${t}::uuid and rn.id = f.renewal_id
              left join contracts.cks_customers cu on cu.tenant_id = ${t}::uuid and cu.id = coalesce(f.customer_id, rn.customer_id)),
              '[]'::jsonb)) as j`,
      ),
    // Chỉ hàng của mình: hẹn nhắc của người khác ≡ không tồn tại (không lộ).
    // Hai bảng (hẹn nhắc CKS HD9 + hẹn nhắc chung W1) trong MỘT câu.
    doneFollowup: async (id) =>
      (await one<number>(
        tx,
        sql`with a as (update contracts.cks_followups set done_at = coalesce(done_at, now())
            where tenant_id = ${t}::uuid and id = ${id}::uuid and user_id = ${ME} returning id),
          b as (update contracts.followups set status = 'done', done_at = coalesce(done_at, now())
            where tenant_id = ${t}::uuid and id = ${id}::uuid and user_id = ${ME} returning id)
          select ((select count(*) from a) + (select count(*) from b))::int as j`,
      )) > 0,
    snoozeFollowup: async (id, localAt, tz) =>
      (await one<number>(
        tx,
        sql`with a as (update contracts.cks_followups set done_at = null,
              due_at = (${localAt}::timestamp at time zone ${tz}::text)
            where tenant_id = ${t}::uuid and id = ${id}::uuid and user_id = ${ME} returning id),
          b as (update contracts.followups set status = 'pending', done_at = null,
              due_at = (${localAt}::timestamp at time zone ${tz}::text)
            where tenant_id = ${t}::uuid and id = ${id}::uuid and user_id = ${ME} and status <> 'done' returning id)
          select ((select count(*) from a) + (select count(*) from b))::int as j`,
      )) > 0,
  };
}
