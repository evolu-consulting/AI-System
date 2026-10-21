// V2-C · KN-08 · HD-10 · DT-05: câu SQL của vai đối tác + gợi ý đối tác + ghi chú — MỘT câu mỗi hàm (Luật 4c), lọc `tenant_id` tường
// minh ngoài RLS; luật thấy M1 do policy của 0024 (vai/ghi chú của đối tác mình thấy hoặc do mình tạo).
import type {
  PartnerContactPerson,
  PartnerContactsPut,
  PartnerContractCount,
  PartnerNote,
  PartnerProfile,
} from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  NoteDelete,
  PartnerContractRaw,
  PartyHit,
  RoleCount,
} from "../application/partner-roles.ports";
import { CONFIRMED_STATUSES, one } from "./ledger-sql";

export type { NoteDelete, PartnerContractRaw, PartyHit, RoleCount };

const CONFIRMED = sql.raw(CONFIRMED_STATUSES.map((s) => `'${s}'`).join(", "));

const ME = sql.raw(`NULLIF(current_setting('app.user_id', true), '')::uuid`);
const NOTE =
  sql.raw(`jsonb_build_object('id', n.id, 'party', n.party_key, 'body', n.body, 'source', n.source,
  'by_user', n.created_by, 'by', contracts.user_label(n.created_by), 'at', n.created_at)`);

export function partnerRolesRepo(tx: Tx, t: string) {
  return {
    ...roleReads(tx, t),
    ...profileReads(tx, t),
    ...contractReads(tx, t),
    ...noteWrites(tx, t),
    ...contactWrites(tx, t),
  };
}
export type PartnerRolesRepo = ReturnType<typeof partnerRolesRepo>;

function roleReads(tx: Tx, t: string) {
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
    find: (key: string, fold: string | null) => one<PartyHit | null>(tx, findQ(t, key, fold)),
  };
}

function findQ(t: string, key: string, fold: string | null) {
  return sql`with hit as (
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
          from hit h left join contracts.companies co on co.tenant_id = ${t}::uuid and co.party_key = h.k`;
}

function profileReads(tx: Tx, t: string) {
  return {
    notes: (party: string) =>
      one<PartnerNote[]>(
        tx,
        sql`select coalesce(jsonb_agg(${NOTE} order by n.created_at desc, n.id desc), '[]'::jsonb) as j
          from (select * from contracts.partner_notes n where n.tenant_id = ${t}::uuid and n.party_key = ${party}
            order by n.created_at desc, n.id desc limit 200) n`,
      ),

    /**
     * V2-I · DT-01: hồ sơ đầu trang chi tiết. Đối tác ngoài phạm vi M1 (không có vai/danh bạ mình thấy) ⇒ null. Liên hệ = người đại
     * diện bên đối tác ở HĐ mới nhất; điện thoại + liên hệ nhập tay lấy từ danh bạ (0037); liên hệ trống ⇒ người đại diện nói trên.
     */
    profile: (party: string) =>
      one<PartnerProfile | null>(
        tx,
        sql`select jsonb_build_object('party', k.party, 'name', coalesce(co.short_name, co.name, pr.name),
            'tax_id', coalesce(co.tax_id, case when k.party like 'tax:%' then substr(k.party, 5) end),
            'phone', coalesce(pc.phone, co.phone), 'contact', coalesce(pc.name, co.contact_person, lc.contact)) as j
          from (select ${party}::text as party) k
          left join contracts.companies co on co.tenant_id = ${t}::uuid and co.party_key = k.party
          left join lateral (select c.name, c.phone from contracts.partner_contacts c
            where c.tenant_id = ${t}::uuid and c.party_key = k.party order by c.sort, c.created_at, c.id limit 1) pc on true
          left join lateral (select p.name from contracts.partner_roles p
            where p.tenant_id = ${t}::uuid and p.party_key = k.party and p.name is not null order by p.first_at limit 1) pr on true
          left join lateral (select case when c.direction = 'sale' then c.buyer_signer else c.seller_signer end as contact
            from contracts.contracts c where c.tenant_id = ${t}::uuid and c.kind = 'contract' and c.partner_key = k.party
            order by c.updated_at desc, c.id desc limit 1) lc on true
          where co.id is not null or pc.name is not null or exists (select 1 from contracts.partner_roles p
            where p.tenant_id = ${t}::uuid and p.party_key = k.party)`,
      ),
  };
}

const CONTACT =
  sql.raw(`jsonb_build_object('id', c.id, 'name', c.name, 'role', c.role, 'phone', c.phone,
  'email', c.email, 'our_owner', c.our_owner)`);

function contactWrites(tx: Tx, t: string) {
  return {
    /** GAP-D2 · #24: người liên hệ của đối tác theo thứ tự đã lưu (RLS M1 của `partner_contacts`). */
    contacts: (party: string) =>
      one<PartnerContactPerson[]>(
        tx,
        sql`select coalesce(jsonb_agg(${CONTACT} order by c.sort, c.created_at, c.id), '[]'::jsonb) as j
          from contracts.partner_contacts c where c.tenant_id = ${t}::uuid and c.party_key = ${party}`,
      ),

    /**
     * GAP-D2 · #24: thay cả danh sách liên hệ của đối tác (xoá + thêm, MỘT câu). Đối tác phải có vai/danh bạ mình thấy; không ⇒ null
     * (404). Xoá luôn điện thoại/liên hệ đơn cũ trên danh bạ để đọc hồ sơ không rơi về giá trị cũ khi danh sách rỗng.
     */
    setContacts: (party: string, rows: PartnerContactsPut["contacts"]) =>
      one<PartnerContactPerson[] | null>(
        tx,
        sql`with ok as (
            select 1 where exists (select 1 from contracts.partner_roles pr where pr.tenant_id = ${t}::uuid and pr.party_key = ${party})
              or exists (select 1 from contracts.companies c0 where c0.tenant_id = ${t}::uuid and c0.party_key = ${party})),
          d as (delete from contracts.partner_contacts c where c.tenant_id = ${t}::uuid and c.party_key = ${party}
            and exists (select 1 from ok) returning 1),
          o as (update contracts.companies co set phone = null, contact_person = null, updated_at = now()
            where co.tenant_id = ${t}::uuid and co.party_key = ${party} and exists (select 1 from ok) returning 1),
          i as (insert into contracts.partner_contacts as c (tenant_id, party_key, name, role, phone, email, our_owner, sort)
            select ${t}::uuid, ${party}, x.v ->> 'name', x.v ->> 'role', x.v ->> 'phone', x.v ->> 'email', x.v ->> 'our_owner',
              (x.ord - 1)::int
            from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) with ordinality as x(v, ord)
            where exists (select 1 from ok)
            returning c.id, c.name, c.role, c.phone, c.email, c.our_owner, c.sort, c.created_at)
          select case when exists (select 1 from ok) then
            coalesce((select jsonb_agg(${CONTACT} order by c.sort, c.id) from i c), '[]'::jsonb) end as j`,
      ),

    /**
     * V2-GAPS · DT-01: lưu điện thoại + liên hệ lên danh bạ (tạo hàng danh bạ nếu đối tác mới chỉ có vai). Đối tác phải có vai/danh
     * bạ mình thấy; không ⇒ null (404). MỘT câu.
     */
    setContact: (party: string, phone: string | null, contact: string | null) =>
      one<{ ok: true } | null>(
        tx,
        sql`with up as (
            insert into contracts.companies as co (tenant_id, party_key, tax_id, name, phone, contact_person, created_from)
            select ${t}::uuid, ${party}, case when ${party}::text like 'tax:%' then substr(${party}::text, 5) end,
              (select p.name from contracts.partner_roles p where p.tenant_id = ${t}::uuid and p.party_key = ${party}
                and p.name is not null order by p.first_at limit 1), ${phone}, ${contact}, 'manual'
            where exists (select 1 from contracts.partner_roles pr where pr.tenant_id = ${t}::uuid and pr.party_key = ${party})
              or exists (select 1 from contracts.companies c0 where c0.tenant_id = ${t}::uuid and c0.party_key = ${party})
            on conflict (tenant_id, party_key) do update set phone = excluded.phone, contact_person = excluded.contact_person,
              updated_at = now()
            returning 1)
          select case when exists (select 1 from up) then jsonb_build_object('ok', true) end as j`,
      ),
  };
}

function contractReads(tx: Tx, t: string) {
  return {
    /** V2-I · DT-06: HĐ đã xác nhận của đối tác (mới nhất trước, ≤ 200) kèm đếm mốc + mốc mở sớm nhất để suy giai đoạn. */
    contracts: (party: string) =>
      one<PartnerContractRaw[]>(
        tx,
        sql`select coalesce(json_agg(json_build_object('id', c.id, 'title', c.title, 'number', c.number, 'deal', c.deal,
            'value', c.value, 'start_date', c.start_date, 'end_date', c.end_date, 'n_req', a.n_req, 'n_req_done', a.n_req_done,
            'n_done', a.n_done, 'next', nx.j) order by c.updated_at desc, c.id desc), '[]'::json) as j
          from (select * from contracts.contracts c where c.tenant_id = ${t}::uuid and c.kind = 'contract'
              and c.partner_key = ${party}::text and c.status in (${CONFIRMED})
            order by c.updated_at desc, c.id desc limit 200) c
          left join lateral (select count(*) filter (where o.kind <> 'renewal' and o.status <> 'cancelled')::int as n_req,
              count(*) filter (where o.kind <> 'renewal' and o.status = 'done')::int as n_req_done,
              count(*) filter (where o.status = 'done')::int as n_done
            from contracts.obligations o
            where o.tenant_id = ${t}::uuid and o.contract_id = c.id and o.status <> 'replaced') a on true
          left join lateral (select json_build_object('id', o.id, 'kind', o.kind, 'direction', o.direction, 'title', o.title,
              'due_date', o.due_date) as j
            from contracts.obligations o where o.tenant_id = ${t}::uuid and o.contract_id = c.id and o.status = 'open'
            order by o.due_date, o.seq limit 1) nx on true`,
      ),

    /** V2-I · DT-01: số HĐ đã xác nhận mỗi đối tác (một câu theo tập, cột `partner_key` có index). */
    contractCounts: () =>
      one<PartnerContractCount[]>(
        tx,
        sql`select coalesce(json_agg(json_build_object('party', x.k, 'n', x.n)), '[]'::json) as j
          from (select c.partner_key as k, count(*)::int as n from contracts.contracts c
            where c.tenant_id = ${t}::uuid and c.kind = 'contract' and c.partner_key is not null and c.status in (${CONFIRMED})
            group by c.partner_key) x`,
      ),
  };
}

function noteWrites(tx: Tx, t: string) {
  return {
    /** Thêm ghi chú khi đối tác có (vai/danh bạ mình thấy); không ⇒ null. */
    addNote: (party: string, body: string, source: "manual" | "internet" = "manual") =>
      one<PartnerNote | null>(
        tx,
        sql`insert into contracts.partner_notes as n (tenant_id, party_key, body, source)
          select ${t}::uuid, ${party}, ${body}, ${source}
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
