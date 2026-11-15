// CR-147b · hồ sơ người trên `hub.people_profiles` (0142) + tên/phòng ban từ `admin.*` (hub_ro). Mỗi hàm MỘT câu, văn bản cố định;
// dữ liệu lô qua MỘT tham số JSON. Mọi câu lọc `tenant_id` tường minh (RLS là lớp thứ hai).
import type { MyPeopleProfile, PersonCard } from "@ai/contracts/people";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

type CardRow = {
  user_id: string;
  display_name: string;
  job_title: string | null;
  avatar: string | null;
  dept_id: string | null;
  dept_name: string | null;
};

/** Thẻ người theo lô: MỘT câu cho cả danh sách (tên + chức vụ + avatar + phòng ban đầu tiên theo khoá). Id ngoài tenant ⇒ bị bỏ.
 *  fix-review-r1 · cờ nội bộ/đối tác của NGƯỜI GỌI lấy từ DB (`me`), không tin token: đối tác (DB hoặc token) chỉ thấy người CÙNG tổ chức
 *  đối tác của mình (không lộ nhân viên chủ quản); người gọi không còn trong tenant ⇒ rỗng. */
export async function cardsOf(
  tx: Tx,
  tenantId: string,
  callerId: string,
  tokenExternal: boolean,
  ids: readonly string[],
): Promise<PersonCard[]> {
  const rows = await tx.execute<CardRow>(sql`
    with me as (select kind, external_org_id from admin.users where id = ${callerId}::uuid and tenant_id = ${tenantId}::uuid)
    select u.id as user_id, u.display_name, pp.job_title, pp.avatar, d.group_id as dept_id, d.name as dept_name
    from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) as i(id)
    join admin.users u on u.id = i.id::uuid and u.tenant_id = ${tenantId}::uuid
    join me on ((me.kind = 'internal' and not ${tokenExternal}::boolean)
      or (u.kind = 'external' and u.external_org_id is not null and u.external_org_id = me.external_org_id))
    left join hub.people_profiles pp on pp.tenant_id = u.tenant_id and pp.user_id = u.id
    left join lateral (
      select g.id as group_id, coalesce(g.name ->> 'vi', g.key) as name
      from admin.group_members gm
      join admin.departments dp on dp.group_id = gm.group_id and dp.tenant_id = gm.tenant_id
      join admin.groups g on g.id = gm.group_id and g.tenant_id = gm.tenant_id
      where gm.user_id = u.id and gm.tenant_id = u.tenant_id
      order by g.key limit 1) d on true`);
  return rows.map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name,
    job_title: r.job_title,
    avatar: r.avatar,
    department: r.dept_id && r.dept_name ? { id: r.dept_id, name: r.dept_name } : null,
  }));
}

export async function myProfile(
  tx: Tx,
  tenantId: string,
  userId: string,
): Promise<MyPeopleProfile> {
  const rows = await tx.execute<MyPeopleProfile>(sql`
    select avatar, cover, job_title from hub.people_profiles
    where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid`);
  return rows[0] ?? { avatar: null, cover: null, job_title: null };
}

/** Ghi MỘT cột ảnh của CHÍNH người gọi (`userId` từ token; RLS ghi cũng chỉ cho `user_id = app.user_id`). */
export async function setImage(
  tx: Tx,
  tenantId: string,
  userId: string,
  col: "avatar" | "cover",
  value: string | null,
): Promise<void> {
  await tx.execute(
    col === "avatar"
      ? sql`insert into hub.people_profiles (tenant_id, user_id, avatar) values (${tenantId}::uuid, ${userId}::uuid, ${value})
          on conflict (tenant_id, user_id) do update set avatar = excluded.avatar, updated_at = now()`
      : sql`insert into hub.people_profiles (tenant_id, user_id, cover) values (${tenantId}::uuid, ${userId}::uuid, ${value})
          on conflict (tenant_id, user_id) do update set cover = excluded.cover, updated_at = now()`,
  );
}
