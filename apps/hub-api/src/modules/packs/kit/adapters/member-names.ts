// Gap #8: tên người dùng của tenant token (cho cột "Phụ trách" khi xuất tệp) — cùng nguồn/điều kiện với `GET /members`
// (`admin.users` qua `withHubScope`, lọc tenant tường minh). Một câu.
import { MEMBERS_MAX } from "@ai/contracts/pack-contracts";
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
  async (who: {
    tenantId: string;
    userId: string;
    userKind?: "internal" | "external";
  }): Promise<Map<string, string>> => {
    if (who.userKind === "external") return new Map(); // CR-102a · com-c2: đối tác không tra tên nhân viên
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      (tx) =>
        tx.execute<{
          id: string;
          name: string;
        }>(sql`select u.id, u.display_name as name from admin.users u
          where u.tenant_id = ${who.tenantId}::uuid and u.kind = 'internal' order by u.id limit ${MEMBERS_MAX * 4}::int`),
    );
    return new Map(rows.map((x) => [x.id, x.name]));
  };

/** CR-132 M3 · tên + «còn dùng được» của các nhân viên NỘI BỘ của tenant trong `ids` (một câu `= any(array)`, không phụ thuộc số id).
 *  Người không có trong kết quả = không phải nhân viên của công ty (ngoài/khác công ty/không tồn tại). Đối tác (external) ⇒ rỗng. */
export const internalUsersAmong =
  (db: Db) =>
  async (
    who: { tenantId: string; userId: string; userKind?: "internal" | "external" },
    ids: readonly string[],
  ): Promise<Map<string, { name: string; active: boolean }>> => {
    const uniq = [...new Set(ids)];
    if (who.userKind === "external" || uniq.length === 0) return new Map();
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      (tx) =>
        tx.execute<{
          id: string;
          name: string;
          active: boolean;
        }>(sql`select u.id, u.display_name as name, (u.active and not u.locked_by_tenant) as active
          from admin.users u
          where u.tenant_id = ${who.tenantId}::uuid and u.kind = 'internal' and u.id = any(${`{${uniq.join(",")}}`}::uuid[])`),
    );
    return new Map(rows.map((x) => [x.id, { name: x.name, active: x.active }]));
  };

/** CR-132b · danh bạ «Thành viên» của Tin nhắn: nhân viên NỘI BỘ còn dùng được của CHÍNH công ty, trừ người gọi, theo tên. Một câu, lọc tenant tường minh.
 *  Đối tác (external) ⇒ rỗng; công ty khác không bao giờ lọt vào. */
export const internalDirectory =
  (db: Db) =>
  async (who: {
    tenantId: string;
    userId: string;
    userKind?: "internal" | "external";
  }): Promise<{ id: string; name: string }[]> => {
    if (who.userKind === "external") return [];
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      (tx) =>
        tx.execute<{ id: string; name: string }>(sql`select u.id, u.display_name as name
          from admin.users u
          where u.tenant_id = ${who.tenantId}::uuid and u.kind = 'internal'
            and u.active and not u.locked_by_tenant and u.id <> ${who.userId}::uuid
          order by u.display_name, u.id limit ${MEMBERS_MAX}::int`),
    );
    return rows.map((x) => ({ id: x.id, name: x.name }));
  };
