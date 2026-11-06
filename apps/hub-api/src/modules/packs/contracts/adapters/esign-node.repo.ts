// CR-122 · E5 · danh bạ công ty cho node Ký số: Group để chọn (panel) + đổi mục `user`/`group` thành user ký (kiểm thuộc công ty). Schema
// `admin` (role gói không đọc) ⇒ scope system hub; MỖI hàm MỘT câu, `tenant_id` tường minh (Luật 4c), không theo hàng.
import type { EsignNodeSigner } from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { NodeDirectory } from "../application/esign.usecase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr = (xs: readonly string[]) => `{${xs.join(",")}}`;
const GROUPS_MAX = 200;

export function esignNodeDirectory(db: Db): NodeDirectory {
  return {
    async groups(tenantId) {
      if (!UUID.test(tenantId)) return [];
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ id: string; key: string; name: string }>(sql`
          select g.id::text as id, g.key,
            case when jsonb_typeof(g.name) = 'string' then g.name #>> '{}'
              else coalesce(g.name ->> 'vi', g.name ->> 'en', g.key) end as name
          from admin.groups g where g.tenant_id = ${tenantId}::uuid order by 3, g.key limit ${GROUPS_MAX}`),
      );
      return [...rows];
    },

    /** Một câu: người cụ thể (còn dùng được) + Group của công ty + thành viên còn dùng được của các Group đó. */
    async resolve(tenantId, entries) {
      const users = [...new Set(entries.filter((e) => e.kind === "user").map((e) => e.id))];
      const groups = [...new Set(entries.filter((e) => e.kind === "group").map((e) => e.id))];
      if (!UUID.test(tenantId) || [...users, ...groups].some((i) => !UUID.test(i)))
        return { userIds: [], unknown: [...entries] };
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ k: string; id: string; g: string | null }>(sql`
          select 'user' as k, u.id::text as id, null::text as g from admin.users u
            where u.tenant_id = ${tenantId}::uuid and u.id = any(${arr(users)}::uuid[])
              and u.active and not u.locked_by_tenant
          union all
          select 'group', g.id::text, null from admin.groups g
            where g.tenant_id = ${tenantId}::uuid and g.id = any(${arr(groups)}::uuid[])
          union all
          select 'member', m.user_id::text, m.group_id::text from admin.group_members m
            join admin.users u on u.id = m.user_id and u.tenant_id = m.tenant_id
            where m.tenant_id = ${tenantId}::uuid and m.group_id = any(${arr(groups)}::uuid[])
              and u.active and not u.locked_by_tenant`),
      );
      const okUser = new Set(rows.filter((r) => r.k === "user").map((r) => r.id));
      const okGroup = new Set(rows.filter((r) => r.k === "group").map((r) => r.id));
      const unknown: EsignNodeSigner[] = entries.filter((e) =>
        e.kind === "user" ? !okUser.has(e.id) : !okGroup.has(e.id),
      );
      // Thứ tự khai: người cụ thể theo danh sách, rồi thành viên từng Group theo thứ tự Group khai (bỏ trùng).
      const byGroup = new Map<string, string[]>();
      for (const r of rows)
        if (r.k === "member" && r.g) byGroup.set(r.g, [...(byGroup.get(r.g) ?? []), r.id]);
      const ordered = entries.flatMap((e) =>
        e.kind === "user"
          ? okUser.has(e.id)
            ? [e.id]
            : []
          : [...(byGroup.get(e.id) ?? [])].sort(),
      );
      return { userIds: [...new Set(ordered)], unknown };
    },
  };
}
