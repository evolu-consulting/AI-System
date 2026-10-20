// W1 · hẹn nhắc chung (`contracts.followups`, port `ledger/followups.py::upsert/mine`): MỘT câu SQL văn bản cố định mỗi hàm, lọc `tenant_id`
// tường minh ngoài RLS. Chủ thể phải TỒN TẠI và NGƯỜI DÙNG THẤY (RLS của đợt/HĐ/gia hạn; đối tác qua `visible_party_keys()`): không thấy ≡
// không có ⇒ không chèn gì (404). Tiêu đề do máy chủ đặt như mgmt-app `subject()`. Một hẹn nhắc mở mỗi người + chủ thể: đặt lại ⇒ dời.
import type { Followup, FollowupCreate } from "@ai/contracts";
import { FOLLOWUP_LIST_MAX } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { FollowupsRepo } from "../application/followups.usecase";
import { one } from "./ledger-sql";

const ME = sql`NULLIF(current_setting('app.user_id', true), '')::uuid`;
const money = (col: string) =>
  sql.raw(
    `coalesce(' ' || replace(to_char(${col}, 'FM999,999,999,999,999'), ',', '.') || ' đ', '')`,
  );

/** Trần tiêu đề = trần `hub.notifications.title` (0040: 1…200) — tiêu đề dài hơn sẽ làm `notify.enqueue` lỗi khi gửi (review B #8). */
export const FOLLOWUP_TITLE_MAX = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function followupsRepo(tx: Tx, t: string): FollowupsRepo {
  return {
    create: (b: FollowupCreate, tz: string) => {
      // So bằng uuid (PK index) thay vì `id::text = …` (review B #19); chủ thể không phải uuid ⇒ null ⇒ không khớp nhánh uuid nào.
      const sid = UUID_RE.test(b.subject_id) ? b.subject_id : null;
      const kind = b.subject_kind;
      return one<string | null>(
        tx,
        sql`with s as (
            select c.id as cid, 'obligation'::text as k,
              (case when o.direction = 'receive' then 'Thu ' else 'Trả ' end
                || coalesce(case when c.direction = 'sale' then c.buyer else c.seller end, 'đối tác') || ${money("o.amount")}) as title
            from contracts.obligations o
            join contracts.contracts c on c.tenant_id = o.tenant_id and c.id = o.contract_id
            where ${kind}::text = 'obligation' and o.tenant_id = ${t}::uuid and o.id = ${sid}::uuid
            union all
            select c.id, 'contract', coalesce(nullif(c.fields -> 'title' ->> 'value', ''), c.number, c.title)
            from contracts.contracts c where ${kind}::text = 'contract' and c.tenant_id = ${t}::uuid and c.id = ${sid}::uuid
            union all
            select r.sale_contract_id, 'renewal', 'Hoàn tất gia hạn chữ ký ' || coalesce(cu.name, '')
            from contracts.cks_renewals r
            left join contracts.cks_customers cu on cu.tenant_id = r.tenant_id and cu.id = r.customer_id
            where ${kind}::text = 'renewal' and r.tenant_id = ${t}::uuid and r.id = ${sid}::uuid
            union all
            select null::uuid, 'company', coalesce((select x.name from contracts.contracts c
                cross join lateral (values
                  (c.buyer, contracts.party_key(c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value')),
                  (c.seller, contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'))
                ) x(name, k)
                where c.tenant_id = ${t}::uuid and x.k = ${b.subject_id} limit 1), ${b.subject_id})
            where ${kind}::text = 'company' and ${b.subject_id} = any (contracts.visible_party_keys()))
          insert into contracts.followups (tenant_id, user_id, subject_kind, subject_id, contract_id, due_at, title, note)
          select ${t}::uuid, ${ME}, ${b.subject_kind}, ${b.subject_id}, s.cid, (${b.at}::timestamp at time zone ${tz}::text),
            left(coalesce(nullif(btrim(s.title), ''), ${b.subject_id}), ${FOLLOWUP_TITLE_MAX}::int), ${b.note}
          from s where s.k = ${b.subject_kind} limit 1
          on conflict (tenant_id, user_id, subject_id) where status <> 'done' do update set
            due_at = excluded.due_at, title = excluded.title, note = excluded.note, status = 'pending',
            contract_id = excluded.contract_id, subject_kind = excluded.subject_kind
          returning to_jsonb(id) as j`,
      );
    },
    mine: (subjectId, tz) =>
      one<Followup[]>(
        tx,
        sql`with f as (select * from contracts.followups g
            where g.tenant_id = ${t}::uuid and g.user_id = ${ME} and g.status <> 'done'
              and (${subjectId}::text is null or g.subject_id = ${subjectId}::text)
            order by g.due_at, g.id limit ${FOLLOWUP_LIST_MAX}::int)
          select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'subject_kind', f.subject_kind, 'subject_id', f.subject_id,
              'contract_id', f.contract_id, 'at', to_char(f.due_at at time zone ${tz}::text, 'YYYY-MM-DD"T"HH24:MI'),
              'title', f.title, 'note', f.note, 'status', f.status) order by f.due_at, f.id), '[]'::jsonb) as j from f`,
      ),
  };
}
