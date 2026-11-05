// CR-112 · ADM-FR-82 · ADM-BR-16: gán/gỡ người vào vai = thành viên Group của vai. Đối tác (user `external`) không bao giờ vào
// vai — có một người ngoài trong lô ⇒ 422 EXTERNAL_USER_NOT_ALLOWED cả lô (trigger 0028 là lưới cuối). Vai/tenant khác ⇒ 404.
// Khoá: vai FOR SHARE → chèn group_members theo user_id tăng → config_meta (cùng thứ tự groups.members).
import type { AppRoleMembersAddRequest, AppRoleMembersAddResponse } from "@ai/contracts/app-roles";
import { sql } from "drizzle-orm";
import { configWrite } from "../../lib/config/config-write";
import { appError, extOrgError } from "../../lib/errors";
import { membersAudit, tenantFilter } from "../groups/groups.service";
import * as repo from "./app-roles.repo";
import { roleGroupKey } from "./app-roles.rules";
import type { Call } from "./app-roles.service";

type Found = { id: string; username: string; kind: string; member: boolean };

export function addRoleMembers(
  c: Call,
  roleId: string,
  input: AppRoleMembersAddRequest,
): Promise<AppRoleMembersAddResponse> {
  return configWrite(c, "group.members", async (tx, ch) => {
    const r = await repo.findRole(tx, tenantFilter(c.actor), roleId, "share");
    if (!r) throw appError("NOT_FOUND");
    const ids = [...input.user_ids].sort();
    const arr = `{${ids.join(",")}}`;
    const found = (await tx.execute(sql`select u.id, u.username, u.kind,
        exists (select 1 from admin.group_members m where m.group_id = ${r.group_id} and m.user_id = u.id) as member
      from admin.users u where u.tenant_id = ${r.tenant_id} and u.id = any(${arr}::uuid[])`)) as unknown as Found[];
    const external = found.filter((f) => f.kind === "external").map((f) => f.username);
    if (external.length > 0)
      throw extOrgError("EXTERNAL_USER_NOT_ALLOWED", { usernames: external });
    const toAdd = found
      .filter((f) => !f.member)
      .map((f) => f.id)
      .sort();
    const inserted =
      toAdd.length === 0
        ? []
        : ((await tx.execute(sql`
      insert into admin.group_members (tenant_id, group_id, user_id, added_by)
      select ${r.tenant_id}::uuid, ${r.group_id}::uuid, x, ${c.actor.userId}::uuid
      from unnest(${`{${toAdd.join(",")}}`}::uuid[]) as x order by x
      on conflict (group_id, user_id) do nothing
      returning user_id`)) as unknown as { user_id: string }[]);
    const added = new Set(inserted.map((i) => i.user_id));
    const seen = new Set(found.map((f) => f.id));
    if (added.size > 0) {
      const g = { id: r.group_id, tenantId: r.tenant_id, key: roleGroupKey(r.pack, r.key) };
      ch.changed({ entity: "group", tenantId: r.tenant_id });
      ch.audit(
        membersAudit(g, { added: found.filter((f) => added.has(f.id)).map((f) => f.username) }),
      );
    }
    return {
      added: input.user_ids.filter((u) => added.has(u)),
      already: input.user_ids.filter((u) => seen.has(u) && !added.has(u)),
      not_found: input.user_ids.filter((u) => !seen.has(u)),
    };
  });
}

/** 204 cả khi không là thành viên (idempotent); vai không thấy được ⇒ 404. */
export function removeRoleMember(c: Call, roleId: string, userId: string): Promise<void> {
  return configWrite(c, "group.members", async (tx, ch) => {
    const r = await repo.findRole(tx, tenantFilter(c.actor), roleId, "share");
    if (!r) throw appError("NOT_FOUND");
    const rows = (await tx.execute(sql`delete from admin.group_members m
      where m.tenant_id = ${r.tenant_id} and m.group_id = ${r.group_id} and m.user_id = ${userId}
      returning (select u.username from admin.users u where u.id = m.user_id) as username`)) as unknown as {
      username: string;
    }[];
    if (rows.length > 0) {
      const g = { id: r.group_id, tenantId: r.tenant_id, key: roleGroupKey(r.pack, r.key) };
      ch.changed({ entity: "group", tenantId: r.tenant_id });
      ch.audit(membersAudit(g, { removed: rows.map((x) => x.username) }));
    }
  });
}
