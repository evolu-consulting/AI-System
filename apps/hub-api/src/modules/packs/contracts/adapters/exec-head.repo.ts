// CR-127 · X3 · R#18: "trưởng phòng của người phụ trách" — `admin.departments.head_user_id` của phòng mà người phụ trách là thành viên (cùng công ty).
// Role gói không đọc `admin.*` ⇒ đọc qua hub scope (system), như `deptHeadOf` của kit. MỘT câu văn bản cố định, `tenant_id` tường minh.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const headOfOwner =
  (db: Db) =>
  async (tenantId: string, ownerId: string, userId: string): Promise<boolean> => {
    if (!UUID.test(tenantId) || !UUID.test(ownerId) || !UUID.test(userId)) return false;
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ h: boolean }>(sql`select exists (
        select 1 from admin.group_members m
          join admin.departments d on d.group_id = m.group_id and d.tenant_id = m.tenant_id
        where m.tenant_id = ${tenantId}::uuid and m.user_id = ${ownerId}::uuid and d.head_user_id = ${userId}::uuid) as h`),
    );
    return rows[0]?.h === true;
  };
