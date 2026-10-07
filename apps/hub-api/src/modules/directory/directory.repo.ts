// HUB-FR-102 · truy vấn danh bạ trên `admin.users` (X2a plan-db §4.5; cột `hub_ro` được GRANT, không migration Admin).
// Lọc tường minh: cùng tenant + đang dùng được (active, không bị tenant khoá) + khác chính mình. Chọn ĐÚNG 4 cột (R22).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type DirectoryRow = { id: string; display_name: string; username: string; active: boolean };
export type DirectoryFilter = { tenantId: string; selfId: string; pattern?: string; limit: number };

export async function searchUsers(tx: Tx, f: DirectoryFilter): Promise<DirectoryRow[]> {
  const match =
    f.pattern === undefined
      ? sql``
      : sql`and (u.display_name ilike ${f.pattern} or u.username ilike ${f.pattern})`;
  return tx.execute<DirectoryRow>(sql`
    select u.id, u.display_name, u.username, u.active
    from admin.users u
    where u.tenant_id = ${f.tenantId} and u.active and not u.locked_by_tenant and u.id <> ${f.selfId}
      ${match}
    order by lower(u.display_name), u.id
    limit ${f.limit}`);
}
