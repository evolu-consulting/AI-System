// CR-102 · com-c3 · công ty đối tác (vai/nhóm hàng/liên kết SHT), nhóm hàng, thống kê hồ sơ, cài đặt người dùng. CR-130 L2 · ADR-0043:
// đối tác có MỘT nguồn ở gói contracts (`partner_roles` + `partner_profiles`); gói này chỉ ĐỌC qua hàm cổng SQL
// `contracts.community_partners(uuid[])` (tenant lấy từ GUC; người xem là đối tác ⇒ chỉ hàng công ty mình). Mỗi hàm MỘT câu.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type PartnerRow = {
  ext_org_id: string;
  /** Vai Bảng tin (CR-130: cùng tên với SHT, `supplier`|`customer`). */
  labels: ("supplier" | "customer")[];
  cats: string[];
  area: string;
  party_key: string | null;
};

type FnRow = {
  ext_org_id: string;
  party_key: string;
  roles: string[];
  cats: string[];
  area: string;
};

/** Vai SHT (`supplier`/`customer`) → nhãn wire. */
export const labelsOf = (roles: readonly string[]): ("supplier" | "customer")[] => [
  ...(roles.includes("supplier") ? (["supplier"] as const) : []),
  ...(roles.includes("customer") ? (["customer"] as const) : []),
];

const orgArray = (ids: readonly string[]) => JSON.stringify(ids);

/** Hồ sơ đối tác (vai, nhóm hàng, khu vực, khoá SHT) của các công ty `orgIds` có hồ sơ đã gắn tài khoản. MỘT câu qua hàm cổng. */
export async function partnerRows(tx: Tx, orgIds: readonly string[]): Promise<PartnerRow[]> {
  if (orgIds.length === 0) return [];
  const rows = await tx.execute<FnRow>(sql`
    select cp.ext_org_id::text as ext_org_id, cp.party_key, cp.roles, cp.cats, cp.area
    from contracts.community_partners(array(select jsonb_array_elements_text(${orgArray(orgIds)}::jsonb)::uuid)) cp`);
  return rows.map((r) => ({
    ext_org_id: r.ext_org_id,
    labels: labelsOf(r.roles),
    cats: r.cats,
    area: r.area,
    party_key: r.party_key,
  }));
}

/** Nhóm hàng người xem được dùng: của công ty đối tác (`orgIds`) ∪ của bài người xem thấy. */
export async function catList(tx: Tx, orgIds: readonly string[]): Promise<string[]> {
  const rows = await tx.execute<{ c: string }>(sql`
    select c from (select unnest(cp.cats) c
        from contracts.community_partners(array(select jsonb_array_elements_text(${orgArray(orgIds)}::jsonb)::uuid)) cp
      union select unnest(cats) c from community.posts) x where c <> '' order by c limit 500`);
  return rows.map((r) => r.c);
}

/** Thống kê bài của một bên (`org = null` ⇒ chủ quản) trong phạm vi người xem thấy. */
export async function profileStats(
  tx: Tx,
  org: string | null,
): Promise<{ active: number; archived: number; comments: number }> {
  const rows = await tx.execute<{ active: number; archived: number; comments: number }>(sql`
    with mine as (select id, status, expires_at from community.posts where author_org is not distinct from ${org}::uuid)
    select (select count(*)::int from mine where status = 'active' and expires_at > now()) as active,
      (select count(*)::int from mine where not (status = 'active' and expires_at > now())) as archived,
      (select count(*)::int from community.comments c where c.post_id in (select id from mine)) as comments`);
  return rows[0] ?? { active: 0, archived: 0, comments: 0 };
}

export type SettingsRow = { notify: Record<string, boolean> };

export async function settingsOf(tx: Tx, userId: string): Promise<SettingsRow | null> {
  const rows = await tx.execute<SettingsRow>(sql`
    select notify from community.settings where user_id = ${userId}::uuid`);
  return rows[0] ?? null;
}

export async function saveSettings(
  tx: Tx,
  tenantId: string,
  userId: string,
  s: SettingsRow,
): Promise<void> {
  await tx.execute(sql`
    insert into community.settings (tenant_id, user_id, notify)
    values (${tenantId}::uuid, ${userId}::uuid, ${JSON.stringify(s.notify)}::jsonb)
    on conflict (tenant_id, user_id) do update set notify = excluded.notify, updated_at = now()`);
}
