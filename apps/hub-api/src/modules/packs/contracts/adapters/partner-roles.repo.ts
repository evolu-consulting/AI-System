// V2-C · KN-08 · HD-10 · DT-05: câu SQL của vai đối tác + gợi ý đối tác + ghi chú — MỘT câu mỗi hàm (Luật 4c), lọc `tenant_id` tường
// minh ngoài RLS; luật thấy M1 do policy của 0024 (vai/ghi chú của đối tác mình thấy hoặc do mình tạo).
import type { PartnerNote, PartnerRoleV2 } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { one } from "./ledger-sql";

export type RoleCount = {
  party: string;
  role: PartnerRoleV2;
  name: string | null;
  created_from: "contract" | "backfill" | "manual";
  contract_id: string | null;
  first_at: string;
  events: number;
  min_events: number | null;
};
export type PartyHit = { party: string; name: string | null; tax_id: string | null };
export type NoteDelete = { deleted: number; exists: boolean };

const ME = sql.raw(`NULLIF(current_setting('app.user_id', true), '')::uuid`);
const NOTE =
  sql.raw(`jsonb_build_object('id', n.id, 'party', n.party_key, 'body', n.body, 'source', n.source,
  'by_user', n.created_by, 'by', contracts.user_label(n.created_by), 'at', n.created_at)`);

export function partnerRolesRepo(tx: Tx, t: string) {
  return {
    /**
     * Vai (một đối tác hoặc tất cả) + số việc mỗi vai (sổ `partner_events` bỏ việc huỷ, chấm tay — dưới RLS của sổ) + số việc tối
     * thiểu đã lưu của vai (`score_configs`, chưa có ⇒ null).
     */
    roles: (party: string | null) =>
      one<RoleCount[]>(
        tx,
        sql`with r as (
            select pr.party_key, pr.role, pr.name, pr.created_from, pr.contract_id, pr.first_at from contracts.partner_roles pr
            where pr.tenant_id = ${t}::uuid and (${party}::text is null or pr.party_key = ${party}::text)),
          ev as (
            select e.party_key, e.role, count(*)::int as n from contracts.partner_events e
            where e.tenant_id = ${t}::uuid and e.party_key in (select r.party_key from r)
              and e.type not in ('rating', 'manual_adjust')
              and not exists (select 1 from contracts.partner_event_voids v where v.tenant_id = e.tenant_id and v.event_id = e.id)
            group by e.party_key, e.role)
          select coalesce(jsonb_agg(jsonb_build_object('party', r.party_key, 'role', r.role, 'name', r.name,
              'created_from', r.created_from, 'contract_id', r.contract_id, 'first_at', r.first_at,
              'events', coalesce(ev.n, 0), 'min_events', (sc.rules ->> 'min_events')::int)
            order by r.party_key, r.role), '[]'::jsonb) as j
          from r left join ev on ev.party_key = r.party_key and ev.role = r.role
            left join contracts.score_configs sc on sc.tenant_id = ${t}::uuid and sc.role = r.role`,
      ),

    /** Đối tác khớp khoá; không có MST ⇒ thêm khớp tên đã fold (vai, danh bạ tên/tên ngắn). Ưu tiên khớp khoá. */
    find: (key: string, fold: string | null) =>
      one<PartyHit | null>(
        tx,
        sql`with hit as (
            select x.k from (
              select pr.party_key as k, 1 as pri from contracts.partner_roles pr
                where pr.tenant_id = ${t}::uuid and pr.party_key = ${key}
              union all
              select co.party_key, 1 from contracts.companies co where co.tenant_id = ${t}::uuid and co.party_key = ${key}
              union all
              select pr.party_key, 2 from contracts.partner_roles pr
                where ${fold}::text is not null and pr.tenant_id = ${t}::uuid and contracts.fold(pr.name) = ${fold}::text
              union all
              select co.party_key, 2 from contracts.companies co
                where ${fold}::text is not null and co.tenant_id = ${t}::uuid
                  and (contracts.fold(co.name) = ${fold}::text or contracts.fold(co.short_name) = ${fold}::text)
            ) x order by x.pri, x.k limit 1)
          select jsonb_build_object('party', h.k,
              'name', coalesce(co.short_name, co.name, (select pr.name from contracts.partner_roles pr
                where pr.tenant_id = ${t}::uuid and pr.party_key = h.k and pr.name is not null order by pr.first_at limit 1)),
              'tax_id', coalesce(co.tax_id, case when h.k like 'tax:%' then substr(h.k, 5) end)) as j
          from hit h left join contracts.companies co on co.tenant_id = ${t}::uuid and co.party_key = h.k`,
      ),

    notes: (party: string) =>
      one<PartnerNote[]>(
        tx,
        sql`select coalesce(jsonb_agg(${NOTE} order by n.created_at desc, n.id desc), '[]'::jsonb) as j
          from (select * from contracts.partner_notes n where n.tenant_id = ${t}::uuid and n.party_key = ${party}
            order by n.created_at desc, n.id desc limit 200) n`,
      ),

    /** Thêm ghi chú khi đối tác có (vai/danh bạ mình thấy); không ⇒ null. */
    addNote: (party: string, body: string) =>
      one<PartnerNote | null>(
        tx,
        sql`insert into contracts.partner_notes as n (tenant_id, party_key, body)
          select ${t}::uuid, ${party}, ${body}
          where exists (select 1 from contracts.partner_roles pr where pr.tenant_id = ${t}::uuid and pr.party_key = ${party})
            or exists (select 1 from contracts.companies co where co.tenant_id = ${t}::uuid and co.party_key = ${party})
          returning ${NOTE} as j`,
      ),

    /** Xoá ghi chú: quản lý xoá mọi ghi chú mình thấy, người khác chỉ ghi chú của mình. `exists` = còn thấy (⇒ 403, không ⇒ 404). */
    deleteNote: (id: string, any: boolean) =>
      one<NoteDelete>(
        tx,
        sql`with d as (
            delete from contracts.partner_notes n where n.tenant_id = ${t}::uuid and n.id = ${id}::uuid
              and (${any}::boolean or n.created_by = ${ME}) returning n.id)
          select jsonb_build_object('deleted', (select count(*) from d),
            'exists', exists (select 1 from contracts.partner_notes n where n.tenant_id = ${t}::uuid and n.id = ${id}::uuid)) as j`,
      ),
  };
}
export type PartnerRolesRepo = ReturnType<typeof partnerRolesRepo>;
