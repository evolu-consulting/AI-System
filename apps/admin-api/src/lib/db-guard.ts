// ADM-NFR-07 · chặn chạy admin-api bằng role DB bỏ qua RLS (plan M1 §3.3): superuser, BYPASSRLS, hoặc sở hữu
// bảng trong schema admin (owner không bị RLS khi không FORCE). Gọi lúc khởi động, lỗi → server exit 1.
import type { Db } from "@ai/db";
import { sql } from "drizzle-orm";

export const UNSAFE_ROLE_MESSAGE =
  "DB role của admin-api không được là superuser/BYPASSRLS/owner — dùng ADMIN_API_DATABASE_URL (admin_api)";

type RoleFlags = { rolsuper: boolean; rolbypassrls: boolean; owns: boolean };

export async function assertSafeDbRole(db: Db): Promise<void> {
  const rows = (await db.db.execute(sql`
    select r.rolsuper, r.rolbypassrls,
           exists(select 1 from pg_tables where schemaname = 'admin' and tableowner = current_user) as owns
    from pg_roles r where r.rolname = current_user`)) as unknown as RoleFlags[];
  const r = rows[0];
  if (!r || r.rolsuper || r.rolbypassrls || r.owns) throw new Error(UNSAFE_ROLE_MESSAGE);
}
