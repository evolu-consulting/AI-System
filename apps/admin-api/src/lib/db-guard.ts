// ADM-NFR-07 · chặn chạy admin-api bằng role DB bỏ qua RLS (plan M1 §3.3): superuser, BYPASSRLS, hoặc sở hữu
// bảng trong schema admin (owner không bị RLS khi không FORCE). Gọi lúc khởi động, lỗi → server exit 1.
import type { Db } from "@ai/db";
import { sql } from "drizzle-orm";

export const UNSAFE_ROLE_MESSAGE =
  "DB role của admin-api không được là superuser/BYPASSRLS/owner — dùng ADMIN_API_DATABASE_URL (admin_api)";

type RoleFlags = { dangerous_role: boolean; owns: boolean };

/**
 * Chặn cả trường hợp gián tiếp (review vòng 1 #4): là thành viên (MEMBER: SET ROLE được) của một role superuser/
 * BYPASSRLS, hoặc của role sở hữu bảng trong schema admin. pg_has_role(x, x, …) = true nên bao luôn chính role.
 */
export async function assertSafeDbRole(db: Db): Promise<void> {
  const rows = (await db.db.execute(sql`
    select
      exists(select 1 from pg_roles r
             where (r.rolsuper or r.rolbypassrls) and pg_has_role(current_user, r.oid, 'MEMBER'))
        as dangerous_role,
      exists(select 1 from pg_tables t
             where t.schemaname = 'admin' and pg_has_role(current_user, t.tableowner, 'MEMBER'))
        as owns`)) as unknown as RoleFlags[];
  const r = rows[0];
  if (!r || r.dangerous_role || r.owns) throw new Error(UNSAFE_ROLE_MESSAGE);
}
