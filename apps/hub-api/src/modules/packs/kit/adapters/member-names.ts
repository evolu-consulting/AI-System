// Gap #8: tên người dùng của tenant token (cho cột "Phụ trách" khi xuất tệp) — cùng nguồn/điều kiện với `GET /members`
// (`admin.users` qua `withHubScope`, lọc tenant tường minh). Một câu.
import { MEMBERS_MAX } from "@ai/contracts";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";

/** cf-esign-docusign · tên + email của CHÍNH user gọi (người ký mặc định bên mình). Một câu, lọc tenant tường minh. */
export const selfContactOf =
  (db: Db) =>
  async (who: {
    tenantId: string;
    userId: string;
  }): Promise<{ name: string; email: string | null }> => {
    const rows = await withHubScope(db, { kind: "user", ...who }, (tx) =>
      tx.execute<{ name: string; email: string | null }>(sql`select u.display_name as name, u.email
        from admin.users u where u.tenant_id = ${who.tenantId}::uuid and u.id = ${who.userId}::uuid`),
    );
    return { name: rows[0]?.name ?? "", email: rows[0]?.email ?? null };
  };

export const memberNamesOf =
  (db: Db) =>
  async (who: { tenantId: string; userId: string }): Promise<Map<string, string>> => {
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      (tx) =>
        tx.execute<{
          id: string;
          name: string;
        }>(sql`select u.id, u.display_name as name from admin.users u
          where u.tenant_id = ${who.tenantId}::uuid order by u.id limit ${MEMBERS_MAX * 4}::int`),
    );
    return new Map(rows.map((x) => [x.id, x.name]));
  };
