// CR-121 · truy vấn hồ sơ công ty (cột `admin.tenants` mới 0035 + phòng ban). RLS vẫn áp (scope của withScope).
import { type Tx, tenants } from "@ai/db";
import { eq, sql } from "drizzle-orm";
import type { ProfileCols } from "./tenants.rules";

type Row = Record<string, unknown>;

export type ProfileRow = ProfileCols & {
  version: number;
  ceoName: string | null;
  directorName: string | null;
  memberCount: number;
};

export type DepartmentRow = {
  groupId: string;
  name: Record<string, string>;
  headId: string | null;
  headName: string | null;
  memberCount: number;
};

/** MỘT câu: cột hồ sơ + tên CEO/Giám đốc + số thành viên đang hoạt động (subquery). */
export async function readProfileRow(tx: Tx, id: string): Promise<ProfileRow | null> {
  const rows = (await tx.execute(sql`
    select t.version, t.legal_name, t.tax_code, t.address, t.staff_size, t.contact_name, t.contact_email,
      t.contact_phone, t.ceo_user_id, t.director_user_id,
      (select u.display_name from admin.users u where u.id = t.ceo_user_id) as ceo_name,
      (select u.display_name from admin.users u where u.id = t.director_user_id) as director_name,
      (select count(*)::int from admin.users u
        where u.tenant_id = t.id and u.active and u.kind = 'internal') as member_count
    from admin.tenants t where t.id = ${id}`)) as unknown as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    version: Number(r.version),
    legalName: (r.legal_name as string | null) ?? null,
    taxCode: (r.tax_code as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    staffSize: r.staff_size === null ? null : Number(r.staff_size),
    contactName: (r.contact_name as string | null) ?? null,
    contactEmail: (r.contact_email as string | null) ?? null,
    contactPhone: (r.contact_phone as string | null) ?? null,
    ceoUserId: (r.ceo_user_id as string | null) ?? null,
    directorUserId: (r.director_user_id as string | null) ?? null,
    ceoName: (r.ceo_name as string | null) ?? null,
    directorName: (r.director_name as string | null) ?? null,
    memberCount: Number(r.member_count),
  };
}

/** MỘT câu theo tập (không SQL theo hàng): phòng ban + trưởng phòng + số thành viên đang hoạt động. Trần 200. */
export async function listDepartments(tx: Tx, tenantId: string): Promise<DepartmentRow[]> {
  const rows = (await tx.execute(sql`
    select d.group_id, g.name, d.head_user_id, hu.display_name as head_name, count(u.id)::int as member_count
    from admin.departments d
    join admin.groups g on g.id = d.group_id
    left join admin.users hu on hu.id = d.head_user_id
    left join admin.group_members gm on gm.group_id = d.group_id
    left join admin.users u on u.id = gm.user_id and u.active and u.kind = 'internal'
    where d.tenant_id = ${tenantId}
    group by d.group_id, g.name, g.key, d.head_user_id, hu.display_name, d.sort_order
    order by d.sort_order nulls last, g.key
    limit 200`)) as unknown as Row[];
  return rows.map((r) => ({
    groupId: String(r.group_id),
    name: (r.name as Record<string, string>) ?? {},
    headId: (r.head_user_id as string | null) ?? null,
    headName: (r.head_name as string | null) ?? null,
    memberCount: Number(r.member_count),
  }));
}

/** Số id (đã khử trùng) là user ĐANG HOẠT ĐỘNG, NỘI BỘ của đúng công ty này. */
export async function countLeaderMembers(tx: Tx, tenantId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = (await tx.execute(sql`
    select count(*)::int as n from admin.users
    where tenant_id = ${tenantId} and active and kind = 'internal'
      and id in (${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )})`)) as unknown as Row[];
  return Number(rows[0]?.n ?? 0);
}

/** Ghi cột đổi + tăng version/updated_at, `updated_by` = người ghi (chỉ gọi khi thực sự có thay đổi). */
export async function updateProfileCols(
  tx: Tx,
  id: string,
  set: Partial<ProfileCols>,
  by: string,
): Promise<void> {
  await tx
    .update(tenants)
    .set({ ...set, version: sql`${tenants.version} + 1`, updatedAt: sql`now()`, updatedBy: by })
    .where(eq(tenants.id, id));
}
