// V2-H · khách đang dùng + nhắc gia hạn + Cài đặt kinh doanh. Câu SQL văn bản cố định, lọc `tenant_id` tường minh ngoài RLS (Luật 4c:
// danh sách = MỘT câu, không theo số dòng). Luật thấy M1 do RLS: `service_customers` (RESTRICTIVE theo HĐ hiện tại của dòng) và
// `contracts` (join) — khách của HĐ mình không thấy không bao giờ vào kết quả. Việc "Liên hệ mời gia hạn" = `contracts.followups`
// (W1) của chính người bấm (`user_id` từ tx), chủ thể = id dòng khách; Cần xử lý / Đã xong dùng sẵn `my-work`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  RawCustomersPage,
  ServiceCustomersRepo,
} from "../application/service-customers.usecase";
import { one } from "./ledger-sql";

const ME = sql`NULLIF(current_setting('app.user_id', true), '')::uuid`;

export function serviceCustomersRepo(tx: Tx, t: string): ServiceCustomersRepo {
  return {
    page: (productId, limit) =>
      one<RawCustomersPage>(
        tx,
        sql`with r as (
            select sc.id, sc.customer_name, sc.party_key, sc.contract_id, c.number as contract_number,
              coalesce(nullif(c.fields -> 'title' ->> 'value', ''), c.number, c.title) as contract_title,
              to_char(sc.started_on, 'YYYY-MM-DD') as started_on, to_char(sc.expires_on, 'YYYY-MM-DD') as expires_on,
              (select n::int from (select contracts.as_bigint(c.fields -> 'notice_days' ->> 'value') as n) x
                where n between 0 and 3650) as notice_days,
              sc.renewals,
              exists (select 1 from contracts.followups f where f.tenant_id = ${t}::uuid and f.user_id = ${ME}
                and f.subject_id = sc.id::text and f.status <> 'done') as reminded
            from contracts.service_customers sc
            join contracts.contracts c on c.tenant_id = sc.tenant_id and c.id = sc.contract_id
            where sc.tenant_id = ${t}::uuid and sc.product_id = ${productId}::uuid
            order by sc.expires_on nulls last, sc.id limit ${limit}::int)
          select jsonb_build_object(
            'product', (select jsonb_build_object('id', p.id, 'name', p.name, 'group', p.grp) from contracts.products p
              where p.tenant_id = ${t}::uuid and p.id = ${productId}::uuid),
            'notice_default', (select b.renewal_notice_days from contracts.business_settings b where b.tenant_id = ${t}::uuid),
            'rows', coalesce((select jsonb_agg(to_jsonb(r)) from r), '[]'::jsonb)) as j`,
      ),
    target: (productId, customerId) =>
      one(
        tx,
        sql`select jsonb_build_object('customer_name', sc.customer_name, 'product_name', p.name, 'contract_id', sc.contract_id) as j
          from contracts.service_customers sc
          join contracts.products p on p.tenant_id = sc.tenant_id and p.id = sc.product_id
          where sc.tenant_id = ${t}::uuid and sc.id = ${customerId}::uuid and sc.product_id = ${productId}::uuid`,
      ),
    addTask: (customerId, contractId, title) =>
      one<string>(
        tx,
        sql`insert into contracts.followups (tenant_id, user_id, subject_kind, subject_id, contract_id, due_at, title)
          values (${t}::uuid, ${ME}, 'renewal', ${customerId}, ${contractId}::uuid, now(), ${title})
          on conflict (tenant_id, user_id, subject_id) where status <> 'done' do update set
            title = excluded.title, contract_id = excluded.contract_id
          returning to_jsonb(id) as j`,
      ),
    noticeDefault: () =>
      one<number | null>(
        tx,
        sql`select to_jsonb(b.renewal_notice_days) as j from contracts.business_settings b where b.tenant_id = ${t}::uuid`,
      ),
    saveNoticeDefault: async (days) => {
      await tx.execute(sql`insert into contracts.business_settings (tenant_id, renewal_notice_days)
        values (${t}::uuid, ${days}::smallint)
        on conflict (tenant_id) do update set renewal_notice_days = excluded.renewal_notice_days,
          updated_by = ${ME}, updated_at = now()`);
    },
  };
}
