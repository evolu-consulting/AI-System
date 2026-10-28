// CR-102 · com-c3 · công ty đối tác (nhãn/nhóm hàng/liên kết SHT), nhóm hàng, thống kê hồ sơ, cài đặt người dùng. RLS lọc
// theo người xem (đối tác: chỉ hàng của công ty mình). Mỗi hàm MỘT câu.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type PartnerRow = {
  ext_org_id: string;
  labels: ("supplier" | "buyer")[];
  cats: string[];
  area: string;
  party_key: string | null;
};

export async function partnerRows(tx: Tx): Promise<PartnerRow[]> {
  return [
    ...(await tx.execute<PartnerRow>(sql`
    select ext_org_id::text as ext_org_id, labels, cats, area, party_key from community.partner_companies`)),
  ];
}

export async function upsertPartner(
  tx: Tx,
  { tenantId, userId }: { tenantId: string; userId: string },
  org: string,
  p: { labels: readonly string[]; cats: readonly string[]; area: string; partyKey: string | null },
): Promise<void> {
  await tx.execute(sql`
    insert into community.partner_companies (tenant_id, ext_org_id, labels, cats, area, party_key, updated_by)
    values (${tenantId}::uuid, ${org}::uuid, array(select distinct jsonb_array_elements_text(${JSON.stringify(p.labels)}::jsonb)),
      array(select distinct jsonb_array_elements_text(${JSON.stringify(p.cats)}::jsonb)), ${p.area}, ${p.partyKey},
      ${userId}::uuid)
    on conflict (tenant_id, ext_org_id) do update set labels = excluded.labels, cats = excluded.cats, area = excluded.area,
      party_key = excluded.party_key, updated_by = excluded.updated_by, updated_at = now()`);
}

/** Nhóm hàng người xem được dùng: của công ty đối tác (RLS) ∪ của bài người xem thấy. */
export async function catList(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ c: string }>(sql`
    select c from (select unnest(cats) c from community.partner_companies
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

export type SettingsRow = { accent: string; notify: Record<string, boolean> };

export async function settingsOf(tx: Tx, userId: string): Promise<SettingsRow | null> {
  const rows = await tx.execute<SettingsRow>(sql`
    select accent, notify from community.settings where user_id = ${userId}::uuid`);
  return rows[0] ?? null;
}

export async function saveSettings(
  tx: Tx,
  tenantId: string,
  userId: string,
  s: SettingsRow,
): Promise<void> {
  await tx.execute(sql`
    insert into community.settings (tenant_id, user_id, accent, notify)
    values (${tenantId}::uuid, ${userId}::uuid, ${s.accent}, ${JSON.stringify(s.notify)}::jsonb)
    on conflict (tenant_id, user_id) do update set accent = excluded.accent, notify = excluded.notify, updated_at = now()`);
}
