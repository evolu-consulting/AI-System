// gap-a1 #7 · người có thể được giao HĐ: thành viên tenant còn dùng được VÀ thuộc nhóm được cấp quyền xem gói hợp đồng. MỘT câu SQL
// (lọc tenant tường minh, nhóm qua một tham số JSON) đọc `admin.users` + `admin.group_members` bằng `hub_ro` như danh bạ thành viên.
import { MEMBERS_MAX } from "@ai/contracts";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { type PackAccessView, packAccessInput } from "../../kit/adapters/pack-guard.middleware";
import type { PackWho } from "../../kit/application/ports";

type Member = { id: string; name: string };

export function packAssignees(db: Db, view: PackAccessView, packKey: string) {
  async function list(who: PackWho, only?: string): Promise<Member[]> {
    const i = await packAccessInput(view, packKey, who);
    const groups = i.entitled && !i.featureOff ? i.grantedByAction.read : [];
    if (groups.length === 0) return [];
    return withHubScope(db, { kind: "user", tenantId: who.tenantId, userId: who.userId }, (tx) =>
      tx.execute<Member>(sql`select u.id, u.display_name as name from admin.users u
        where u.tenant_id = ${who.tenantId}::uuid and u.active and not u.locked_by_tenant
          and (${only ?? null}::uuid is null or u.id = ${only ?? null}::uuid)
          and exists (select 1 from admin.group_members gm where gm.tenant_id = u.tenant_id and gm.user_id = u.id
            and gm.group_id = any(array(select jsonb_array_elements_text(${JSON.stringify(groups)}::jsonb))::uuid[]))
        order by lower(u.display_name), u.id limit ${MEMBERS_MAX}::int`),
    ).then((rows) => rows.map((x) => ({ id: x.id, name: x.name })));
  }
  return {
    list: (who: PackWho) => list(who),
    assignable: async (who: PackWho, userId: string) => (await list(who, userId)).length > 0,
  };
}
