// CR-102 · com-c9 · "chủ quản" của một gói = user NỘI BỘ còn dùng được (active, không bị khoá) của tenant, là `tenant_admin` hoặc
// thuộc Group được cấp việc `read` của gói (cache cấu hình cho Group, MỘT câu admin.users). Người nhận thông báo của chủ quản.
import { packFeatureKey } from "@ai/contracts";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { PackAccessView } from "./pack-guard.middleware";

export function packHosts(db: Db, view: PackAccessView, packKey: string) {
  return async (tenantId: string): Promise<string[]> => {
    await view.adminSettled?.();
    const cat = await view.catalog();
    const f = cat.features.find((x) => x.key === packFeatureKey(packKey, "read"));
    if (!f || f.status === "off" || !cat.entitled.has(`${tenantId}:${f.id}`)) return [];
    const groups = cat.grantGroups.get(`${tenantId}:${f.id}`) ?? [];
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ id: string }>(sql`select u.id::text as id from admin.users u
        where u.tenant_id = ${tenantId}::uuid and u.kind = 'internal' and u.active and not u.locked_by_tenant
          and (u.role = 'tenant_admin' or exists (select 1 from admin.group_members gm
            where gm.tenant_id = u.tenant_id and gm.user_id = u.id
              and gm.group_id = any(array(select jsonb_array_elements_text(${JSON.stringify(groups)}::jsonb))::uuid[])))
        order by u.id limit 500`),
    );
    return rows.map((r) => r.id);
  };
}
