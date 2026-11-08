// CR-125 B1 · S1b · chặn chạy hub-api bằng role DB bỏ qua RLS (port `apps/admin-api/src/lib/db-guard.ts`): superuser,
// BYPASSRLS, hoặc sở hữu bảng trong schema hub/admin (owner không bị RLS khi chưa FORCE). Gọi lúc khởi động, lỗi → exit 1.
// Không xét schema gói (`packs`, contracts…): hub_api là thành viên SET-được của role gói (`<k>_rw`, 0001_kit) — phía gói có
// `secure_table` riêng.
import type { Db } from "@ai/db";
import { sql } from "drizzle-orm";

export const UNSAFE_ROLE_MESSAGE =
  "DB role của hub-api không được là superuser/BYPASSRLS/owner bảng hub/admin — dùng HUB_DATABASE_URL (hub_api)";

/** Schema mà role runtime không được sở hữu bảng nào. `[]` = chỉ kiểm superuser/BYPASSRLS. */
export const GUARDED_SCHEMAS = ["hub", "admin"] as const;

type RoleFlags = { dangerous_role: boolean; owns: boolean };

/** Thuần: cờ của role → lỗi hay không (để unit test không cần DB). */
export function unsafeRole(r: RoleFlags | undefined): boolean {
  return !r || r.dangerous_role || r.owns;
}

/**
 * Chặn cả trường hợp gián tiếp: MEMBER (SET ROLE được) của role superuser/BYPASSRLS, hoặc của role sở hữu bảng trong
 * `schemas`. pg_has_role(x, x, …) = true nên bao luôn chính role.
 */
export async function assertSafeDbRole(
  db: Db,
  schemas: readonly string[] = GUARDED_SCHEMAS,
): Promise<void> {
  const rows = (await db.db.execute(sql`
    select
      exists(select 1 from pg_roles r
             where (r.rolsuper or r.rolbypassrls) and pg_has_role(current_user, r.oid, 'MEMBER'))
        as dangerous_role,
      exists(select 1 from pg_tables t
             where t.schemaname = any(${`{${schemas.join(",")}}`}::text[])
               and pg_has_role(current_user, t.tableowner, 'MEMBER'))
        as owns`)) as unknown as RoleFlags[];
  if (unsafeRole(rows[0])) throw new Error(UNSAFE_ROLE_MESSAGE);
}
