// CR-130 pha 2 · L3 · ADR-0043: câu SQL hồ sơ Bảng tin của đối tác SHT (`contracts.partner_profiles`) — MỘT câu mỗi hàm, lọc `tenant_id`
// tường minh ngoài RLS. Đối tác chỉ "có" khi có vai/danh bạ người dùng thấy (như ghi chú); ghi do policy 0103 (quản trị gói) chốt thứ hai.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PartnerProfileRepo, ProfileRaw } from "../application/partner-community.ports";
import { one } from "./ledger-sql";

const visible = (t: string, party: string) => sql`(
  exists (select 1 from contracts.partner_roles pr where pr.tenant_id = ${t}::uuid and pr.party_key = ${party})
  or exists (select 1 from contracts.companies co where co.tenant_id = ${t}::uuid and co.party_key = ${party}))`;

const WHO = sql.raw(`NULLIF(current_setting('app.user_id', true), '')::uuid`);

/** Hồ sơ + vai + tên SHT (vai mới nhất → hồ sơ công ty), một câu. Đối tác ngoài phạm vi ⇒ không hàng. */
function getQ(t: string, party: string) {
  return sql`select jsonb_build_object('party', k.party,
      'name', coalesce(
        (select r.name from contracts.partner_roles r where r.tenant_id = ${t}::uuid and r.party_key = k.party
          and r.name is not null and r.name <> '' order by r.first_at desc, r.id limit 1),
        (select coalesce(co.short_name, co.name) from contracts.companies co
          where co.tenant_id = ${t}::uuid and co.party_key = k.party limit 1)),
      'roles', coalesce((select jsonb_agg(r.role order by r.role) from contracts.partner_roles r
        where r.tenant_id = ${t}::uuid and r.party_key = k.party and r.role in ('supplier', 'customer')), '[]'::jsonb),
      'cats', to_jsonb(coalesce(pp.cats, '{}'::text[])), 'area', coalesce(pp.area, ''),
      'ext_org_id', pp.ext_org_id, 'invited_at', pp.invited_at) as j
    from (select ${party}::text as party) k
    left join contracts.partner_profiles pp on pp.tenant_id = ${t}::uuid and pp.party_key = k.party
    where ${visible(t, party)}`;
}

export function partnerProfileRepo(tx: Tx, t: string): PartnerProfileRepo {
  return {
    get: (party) => one<ProfileRaw | null>(tx, getQ(t, party)),

    /** Thay nhóm hàng + khu vực (tạo hồ sơ nếu chưa có). Một câu; đối tác ngoài phạm vi ⇒ không ghi. */
    saveProfile: (party, cats, area) =>
      one<{ ok: true } | null>(
        tx,
        sql`with up as (
            insert into contracts.partner_profiles as pp (tenant_id, party_key, cats, area)
            select ${t}::uuid, ${party}, array(select jsonb_array_elements_text(${JSON.stringify(cats)}::jsonb)), ${area}
            where ${visible(t, party)}
            on conflict (tenant_id, party_key) do update set cats = excluded.cats, area = excluded.area, updated_at = now(),
              updated_by = ${WHO}
            returning 1)
          select case when exists (select 1 from up) then jsonb_build_object('ok', true) end as j`,
      ),

    /** Mời (gắn `ext_org_id`, đặt `invited_at` khi đổi tài khoản) hoặc gỡ (`null`). Tài khoản đã gắn đối tác khác ⇒ lỗi 23505. */
    setAccount: (party, orgId) =>
      one<{ ok: true } | null>(
        tx,
        sql`with up as (
            insert into contracts.partner_profiles as pp (tenant_id, party_key, ext_org_id, invited_at)
            select ${t}::uuid, ${party}, ${orgId}::uuid, case when ${orgId}::uuid is not null then now() end
            where ${visible(t, party)}
            on conflict (tenant_id, party_key) do update set ext_org_id = excluded.ext_org_id,
              invited_at = case when excluded.ext_org_id is null then null
                when pp.ext_org_id is not distinct from excluded.ext_org_id then pp.invited_at else now() end,
              updated_at = now(), updated_by = ${WHO}
            returning 1)
          select case when exists (select 1 from up) then jsonb_build_object('ok', true) end as j`,
      ),

    linkedOrgs: () =>
      one<string[]>(
        tx,
        sql`select coalesce(jsonb_agg(pp.ext_org_id), '[]'::jsonb) as j from contracts.partner_profiles pp
          where pp.tenant_id = ${t}::uuid and pp.ext_org_id is not null`,
      ),
  };
}
