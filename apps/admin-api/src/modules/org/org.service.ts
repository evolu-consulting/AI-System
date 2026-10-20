// M1D-FR-02 · M1D-FR-03 · docs/specs/M1-departments: cơ cấu tổ chức của tenant — đọc một lần (thành viên + quản lý + phòng ban),
// gán/bỏ quản lý (closure + cấm vòng ở trigger DB `admin.user_managers_*`), đánh dấu Group là phòng ban + trưởng phòng.
// tenant_admin chỉ tenant mình; platform cần `?tenant_id` khi ghi. Ghi qua `configWrite` (một tx + audit).
import {
  type DepartmentSetRequest,
  type ManagerSetRequest,
  ORG_MEMBERS_MAX,
  type OrgResponse,
} from "@ai/contracts";
import { type Db, type DbScope, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { checkViolation, foreignKeyViolation } from "../../lib/pg-errors";
import type { TestHooks } from "../../lib/test-hooks";
import { type Actor, resolveTenantScope } from "../users/users.rules";

export type OrgCall = { ctx: { db: Db; hooks?: TestHooks }; actor: Actor; scope: DbScope };

function tenantOf(c: OrgCall, q: string | undefined, op: "read" | "write"): string {
  const r = resolveTenantScope(c.actor, q, op);
  if ("code" in r) throw appError(r.code);
  if (r.tenantId === null) throw appError("TENANT_REQUIRED");
  return r.tenantId;
}

type OrgRow = {
  members: OrgResponse["members"] | string;
  departments: OrgResponse["departments"] | string;
};

/** MỘT câu: thành viên đang hoạt động (≤ ORG_MEMBERS_MAX) + quản lý, phòng ban + id thành viên. */
export function getOrg(c: OrgCall, q: string | undefined): Promise<OrgResponse> {
  const t = tenantOf(c, q, "read");
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const rows = (await tx.execute(sql`select
      coalesce((select json_agg(json_build_object('user_id', u.id, 'username', u.username,
          'display_name', u.display_name, 'manager_id', m.manager_id) order by lower(u.display_name), u.id)
        from (select * from admin.users where tenant_id = ${t}::uuid and active
              order by lower(display_name), id limit ${ORG_MEMBERS_MAX}::int) u
        left join admin.user_managers m on m.user_id = u.id and m.tenant_id = u.tenant_id), '[]'::json) as members,
      coalesce((select json_agg(json_build_object('group_id', g.id, 'key', g.key,
          'name', coalesce(g.name ->> 'vi', g.key), 'head_user_id', d.head_user_id,
          'member_ids', coalesce((select json_agg(gm.user_id order by gm.user_id) from admin.group_members gm
            where gm.group_id = g.id and gm.tenant_id = g.tenant_id), '[]'::json)) order by g.key)
        from admin.departments d join admin.groups g on g.id = d.group_id and g.tenant_id = d.tenant_id
        where d.tenant_id = ${t}::uuid), '[]'::json) as departments`)) as unknown as OrgRow[];
    const r = rows[0] as OrgRow;
    const parse = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
    return { members: parse(r.members), departments: parse(r.departments) };
  });
}

/** Gán (upsert) hoặc bỏ (null) quản lý của `userId`. User/quản lý ngoài tenant ⇒ 404; vòng ⇒ 400 `manager_cycle`. */
export function setManager(
  c: OrgCall,
  q: string | undefined,
  userId: string,
  input: ManagerSetRequest,
): Promise<{ user_id: string; manager_id: string | null }> {
  const t = tenantOf(c, q, "write");
  return configWrite(c, "group.save", async (tx, ch) => {
    // M1c (review A-10): quản lý cũ đọc cùng tx (khoá hàng user) ⇒ audit có `summary.before`.
    const u = (await tx.execute(sql`select u.username, m.manager_id from admin.users u
      left join admin.user_managers m on m.user_id = u.id and m.tenant_id = u.tenant_id
      where u.id = ${userId}::uuid and u.tenant_id = ${t}::uuid for no key update of u`)) as unknown as {
      username: string;
      manager_id: string | null;
    }[];
    if (!u[0]) throw appError("NOT_FOUND");
    if (input.manager_id === null) {
      await tx.execute(
        sql`delete from admin.user_managers where user_id = ${userId}::uuid and tenant_id = ${t}::uuid`,
      );
    } else {
      await tx
        .transaction((sp) =>
          sp.execute(sql`insert into admin.user_managers (tenant_id, user_id, manager_id, updated_by)
            values (${t}::uuid, ${userId}::uuid, ${input.manager_id}::uuid, ${c.actor.userId}::uuid)
            on conflict (user_id) do update set manager_id = excluded.manager_id, updated_at = now(),
              updated_by = excluded.updated_by`),
        )
        .catch((err) => {
          if (foreignKeyViolation(err) === "user_managers_manager_fk") throw appError("NOT_FOUND");
          const ck = checkViolation(err);
          if (ck === "user_managers_cycle_ck" || ck === "user_managers_self_ck")
            throw appError("VALIDATION_ERROR", { reason: "manager_cycle" });
          throw err;
        });
    }
    ch.changed({ entity: "user", tenantId: t });
    ch.audit(
      auditOf("update", "user", {
        entityId: userId,
        entityName: u[0].username,
        tenantId: t,
        before: null,
        after: null,
        summary: { manager_id: input.manager_id, before: { manager_id: u[0].manager_id } },
      }),
    );
    return { user_id: userId, manager_id: input.manager_id };
  });
}

/** Đánh dấu Group là phòng ban (upsert trưởng phòng); `remove` ⇒ bỏ đánh dấu (Group giữ nguyên). */
export function setDepartment(
  c: OrgCall,
  q: string | undefined,
  groupId: string,
  input: DepartmentSetRequest | "remove",
): Promise<{ group_id: string; head_user_id: string | null } | null> {
  const t = tenantOf(c, q, "write");
  return configWrite(c, "group.save", async (tx, ch) => {
    const g = (await tx.execute(sql`select g.key, d.head_user_id, d.group_id is not null as dept
      from admin.groups g left join admin.departments d on d.group_id = g.id and d.tenant_id = g.tenant_id
      where g.id = ${groupId}::uuid and g.tenant_id = ${t}::uuid for no key update of g`)) as unknown as {
      key: string;
      head_user_id: string | null;
      dept: boolean;
    }[];
    if (!g[0]) throw appError("NOT_FOUND");
    if (input === "remove") {
      await tx.execute(
        sql`delete from admin.departments where group_id = ${groupId}::uuid and tenant_id = ${t}::uuid`,
      );
    } else {
      await tx
        .transaction((sp) =>
          sp.execute(sql`insert into admin.departments (tenant_id, group_id, head_user_id)
            values (${t}::uuid, ${groupId}::uuid, ${input.head_user_id}::uuid)
            on conflict (group_id) do update set head_user_id = excluded.head_user_id, updated_at = now()`),
        )
        .catch((err) => {
          if (foreignKeyViolation(err) === "departments_head_fk") throw appError("NOT_FOUND");
          throw err;
        });
    }
    ch.changed({ entity: "group", tenantId: t });
    ch.audit(
      auditOf("update", "group", {
        entityId: groupId,
        entityName: g[0].key,
        tenantId: t,
        before: null,
        after: null,
        summary: {
          department: input === "remove" ? null : { head_user_id: input.head_user_id },
          before: { department: g[0].dept ? { head_user_id: g[0].head_user_id } : null },
        },
      }),
    );
    return input === "remove" ? null : { group_id: groupId, head_user_id: input.head_user_id };
  });
}
