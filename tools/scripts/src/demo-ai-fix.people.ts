// friendly-groups · demo hiện thực hơn: phòng ban tên thật, người dùng tên tiếng Việt, bỏ nhóm "Beta testers". CHỈ tenant `demo`
// (demo-ai-fix chặn trước), lặp lại được. Giữ nguyên username/mật khẩu/email (demo-owner…) và khoá Group/phòng ⇒ đăng nhập + e2e không đổi.
import type postgres from "postgres";

type Tx = postgres.TransactionSql;

/** Khoá phòng (Group) → tên hiển thị. `pb-kho-van` chưa có thì tạo thêm. */
export const DEMO_DEPARTMENTS: readonly { key: string; vi: string; en: string }[] = [
  { key: "pb-giam-doc", vi: "Ban Giám đốc", en: "Board of Directors" },
  { key: "pb-kinh-doanh", vi: "Phòng Kinh doanh", en: "Sales" },
  { key: "pb-ke-toan", vi: "Phòng Kế toán", en: "Accounting" },
  { key: "pb-kho-van", vi: "Kho vận", en: "Warehouse & Logistics" },
];

/** Email (cố định) → tên hiển thị tiếng Việt + phòng. Vai Group (contracts-*) giữ nguyên. */
export const DEMO_PEOPLE: readonly { email: string; name: string; dept: string }[] = [
  { email: "demo-owner@example.invalid", name: "Nguyễn Văn An – Giám đốc", dept: "pb-giam-doc" },
  {
    email: "demo-editor@example.invalid",
    name: "Lê Quốc Cường – Trưởng phòng Kinh doanh",
    dept: "pb-kinh-doanh",
  },
  { email: "demo-viewer@example.invalid", name: "Trần Thị Bình – Kế toán", dept: "pb-ke-toan" },
];

export type PeoplePlan = { departments: number; people: number; beta: number };

/** Đếm việc còn phải làm (0 ⇒ đã xong). */
export async function planPeople(tx: Tx, t: string): Promise<PeoplePlan> {
  const [r] = await tx<{ d: number; p: number; b: number }[]>`select
    (select count(*)::int from jsonb_to_recordset(${JSON.stringify(DEMO_DEPARTMENTS)}::text::jsonb) as x(key text, vi text, en text)
      where not exists (select 1 from admin.groups g where g.tenant_id = ${t} and g.key = x.key and g.name ->> 'vi' = x.vi)) as d,
    (select count(*)::int from jsonb_to_recordset(${JSON.stringify(DEMO_PEOPLE)}::text::jsonb) as x(email text, name text, dept text)
      join admin.users u on u.tenant_id = ${t} and u.email = x.email
      where u.display_name <> x.name) as p,
    (select count(*)::int from admin.groups where tenant_id = ${t} and key = 'beta-testers') as b`;
  return { departments: r?.d ?? 0, people: r?.p ?? 0, beta: r?.b ?? 0 };
}

export async function applyPeople(tx: Tx, t: string): Promise<void> {
  await tx`select set_config('app.tenant_id', ${t}, true)`;
  // Phòng: đổi tên nếu có; thiếu thì tạo Group + hàng phòng ban.
  await tx`insert into admin.groups (tenant_id, key, name)
    select ${t}::uuid, x.key, jsonb_build_object('vi', x.vi, 'en', x.en)
    from jsonb_to_recordset(${JSON.stringify(DEMO_DEPARTMENTS)}::text::jsonb) as x(key text, vi text, en text)
    on conflict (tenant_id, key) do update set name = excluded.name, updated_at = now()`;
  await tx`insert into admin.departments (tenant_id, group_id)
    select g.tenant_id, g.id from admin.groups g
    where g.tenant_id = ${t} and g.key = any(${DEMO_DEPARTMENTS.map((d) => d.key)}::text[])
    on conflict (group_id) do nothing`;
  // Người dùng: chỉ đổi tên hiển thị; vào đúng phòng (thêm thành viên, không bớt ai); trưởng phòng nếu còn trống.
  await tx`update admin.users u set display_name = x.name, updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(DEMO_PEOPLE)}::text::jsonb) as x(email text, name text, dept text)
    where u.tenant_id = ${t} and u.email = x.email and u.display_name <> x.name`;
  await tx`insert into admin.group_members (tenant_id, group_id, user_id)
    select ${t}::uuid, g.id, u.id
    from jsonb_to_recordset(${JSON.stringify(DEMO_PEOPLE)}::text::jsonb) as x(email text, name text, dept text)
    join admin.users u on u.tenant_id = ${t} and u.email = x.email
    join admin.groups g on g.tenant_id = ${t} and g.key = x.dept
    on conflict (group_id, user_id) do nothing`;
  await tx`update admin.departments d set head_user_id = u.id, updated_at = now()
    from admin.groups g, admin.users u
    where d.group_id = g.id and g.tenant_id = ${t} and g.key = 'pb-giam-doc' and d.head_user_id is null
      and u.tenant_id = ${t} and u.email = ${DEMO_PEOPLE[0]?.email ?? ""}`;
  // "Beta testers" do trigger tạo tenant sinh ra — demo không dùng.
  await tx`delete from admin.groups where tenant_id = ${t} and key = 'beta-testers'`;
}
