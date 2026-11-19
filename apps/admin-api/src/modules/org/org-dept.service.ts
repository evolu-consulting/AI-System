// CR-189 · BR-189-6 · sửa cơ cấu trực tiếp trên sơ đồ: tạo phòng (một lời gọi), đổi tên, xoá phòng (chỉ phòng rỗng).
// Phòng ban = `admin.groups` + hàng `admin.departments`. Mỗi thao tác một `configWrite` (một giao dịch, audit, bump);
// khoá theo thứ tự cố định ở `org.shared.ts` (advisory công ty → groups theo id → group_members). Chỉ quản trị (router).
import type {
  DeptCreateRequest,
  DeptCreateResponse,
  DeptRenameRequest,
  DeptRenameResponse,
} from "@ai/contracts/org";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError, extOrgError, orgDeptError } from "../../lib/errors";
import { checkViolation, foreignKeyViolation } from "../../lib/pg-errors";
import { groupRefCounts } from "./org.hub";
import { assertNameFree, groupKeyOf, lockOrgTree, type OrgCall, tenantOf } from "./org.shared";

/** Khoá hàng group (NO KEY UPDATE) và đọc phòng; chưa là phòng ban / ngoài công ty ⇒ 404. */
async function lockedDept(tx: Tx, t: string, groupId: string) {
  const r =
    (await tx.execute(sql`select g.key, g.name ->> 'vi' as name, d.head_user_id, d.parent_group_id
    from admin.groups g join admin.departments d on d.group_id = g.id and d.tenant_id = g.tenant_id
    where g.id = ${groupId}::uuid and g.tenant_id = ${t}::uuid for no key update of g`)) as unknown as {
      key: string;
      name: string;
      head_user_id: string | null;
      parent_group_id: string | null;
    }[];
  if (!r[0]) throw appError("NOT_FOUND");
  return r[0];
}

/**
 * Tạo phòng con một lời gọi (Group + phòng ban + trưởng phòng tuỳ chọn). Cha phải là phòng của công ty (404);
 * tên không trùng cùng cấp (409 `NAME_TAKEN`); trưởng phòng ngoài công ty ⇒ 404, đối tác ⇒ 422.
 */
export function createDept(
  c: OrgCall,
  q: string | undefined,
  input: DeptCreateRequest,
): Promise<DeptCreateResponse> {
  const t = tenantOf(c, q, "write");
  const parent = input.parent_group_id ?? null;
  const head = input.head_user_id ?? null;
  return configWrite(c, "group.save", async (tx, ch) => {
    await lockOrgTree(tx, t);
    if (parent !== null) {
      const p = (await tx.execute(sql`select 1 from admin.groups g
        join admin.departments d on d.group_id = g.id and d.tenant_id = g.tenant_id
        where g.id = ${parent}::uuid and g.tenant_id = ${t}::uuid for share of g`)) as unknown as unknown[];
      if (p.length === 0) throw appError("NOT_FOUND");
    }
    await assertNameFree(tx, t, { name: input.name, parent, except: null });
    const keys = (await tx.execute(
      sql`select key from admin.groups where tenant_id = ${t}::uuid`,
    )) as unknown as { key: string }[];
    const key = groupKeyOf(input.name, new Set(keys.map((k) => k.key)));
    const id = Bun.randomUUIDv7();
    await tx.execute(sql`insert into admin.groups (id, tenant_id, key, name, updated_by)
      values (${id}::uuid, ${t}::uuid, ${key}, ${JSON.stringify({ vi: input.name })}::jsonb, ${c.actor.userId}::uuid)`);
    await tx
      .transaction((sp) =>
        sp.execute(sql`insert into admin.departments (tenant_id, group_id, head_user_id, parent_group_id)
          values (${t}::uuid, ${id}::uuid, ${head}::uuid, ${parent}::uuid)`),
      )
      .catch((err) => {
        if (foreignKeyViolation(err) === "departments_head_fk") throw appError("NOT_FOUND");
        if (checkViolation(err) === "departments_head_internal_ck")
          throw extOrgError("EXTERNAL_USER_NOT_ALLOWED");
        throw err;
      });
    ch.changed({ entity: "group", tenantId: t });
    ch.audit(
      auditOf("create", "group", {
        entityId: id,
        entityName: key,
        tenantId: t,
        before: null,
        after: null,
        summary: { department: { name: input.name, head_user_id: head, parent_group_id: parent } },
      }),
    );
    return { group_id: id, key, name: input.name, parent_group_id: parent, head_user_id: head };
  });
}

/** Đổi tên phòng (giữ `name.en` nếu có; `version` +1 như PATCH /admin/groups). Trùng tên cùng cấp ⇒ 409 `NAME_TAKEN`. Trả tên cũ cho Hoàn tác. */
export function renameDept(
  c: OrgCall,
  q: string | undefined,
  groupId: string,
  input: DeptRenameRequest,
): Promise<DeptRenameResponse> {
  const t = tenantOf(c, q, "write");
  return configWrite(c, "group.save", async (tx, ch) => {
    await lockOrgTree(tx, t);
    const g = await lockedDept(tx, t, groupId);
    if (g.name === input.name) return { group_id: groupId, name: g.name, before: g.name };
    await assertNameFree(tx, t, { name: input.name, parent: g.parent_group_id, except: groupId });
    await tx.execute(sql`update admin.groups set name = jsonb_set(name, '{vi}', to_jsonb(${input.name}::text)),
      version = version + 1, updated_at = now(), updated_by = ${c.actor.userId}::uuid
      where id = ${groupId}::uuid and tenant_id = ${t}::uuid`);
    ch.changed({ entity: "group", tenantId: t });
    ch.audit(
      auditOf("update", "group", {
        entityId: groupId,
        entityName: g.key,
        tenantId: t,
        before: null,
        after: null,
        summary: { name: input.name, before: { name: g.name } },
      }),
    );
    return { group_id: groupId, name: input.name, before: g.name };
  });
}

type EmptyCheck = { members: number; children: number; has_access: boolean };

/**
 * Xoá phòng: CHẶN khi còn người (thành viên + trưởng phòng, không đếm trùng) hoặc phòng con ⇒ 409 `DEPT_NOT_EMPTY`
 * `{ members, children }`; nhóm đang được giao việc duyệt ĐANG MỞ (Hub) ⇒ 409 `DEPT_IN_USE` `{ open_reviews }`. Phòng rỗng:
 * bỏ hàng phòng ban; Group bị xoá theo, TRỪ khi Group còn được dùng — `feature_grants`, vai, `hub.agent_grants`,
 * `process_defs.run_group_ids`, từng được giao việc duyệt (đã đóng) — khi đó Group giữ lại để không mất cấu hình. Trả `{ group_deleted }`.
 */
export function deleteDept(
  c: OrgCall,
  q: string | undefined,
  groupId: string,
): Promise<{ group_deleted: boolean }> {
  const t = tenantOf(c, q, "write");
  return configWrite(c, "group.delete", async (tx, ch) => {
    await lockOrgTree(tx, t);
    const g = await lockedDept(tx, t, groupId);
    const n = (await tx.execute(sql`select
      (select count(*)::int from (select user_id from admin.group_members
          where group_id = ${groupId}::uuid and tenant_id = ${t}::uuid
        union select ${g.head_user_id}::uuid where ${g.head_user_id}::uuid is not null) p) as members,
      (select count(*)::int from admin.departments where parent_group_id = ${groupId}::uuid and tenant_id = ${t}::uuid) as children,
      (exists(select 1 from admin.feature_grants where group_id = ${groupId}::uuid and tenant_id = ${t}::uuid)
        or exists(select 1 from admin.app_roles where group_id = ${groupId}::uuid and tenant_id = ${t}::uuid)) as has_access`)) as unknown as EmptyCheck[];
    const r = n[0] as EmptyCheck;
    if (r.members > 0 || r.children > 0)
      throw orgDeptError("DEPT_NOT_EMPTY", { members: r.members, children: r.children });
    const refs = await groupRefCounts(tx, t, groupId);
    if (refs.reviewsOpen > 0) throw orgDeptError("DEPT_IN_USE", { open_reviews: refs.reviewsOpen });
    const keep = r.has_access || refs.agents + refs.processes + refs.reviewsAny > 0;
    await tx.execute(
      sql`delete from admin.departments where group_id = ${groupId}::uuid and tenant_id = ${t}::uuid`,
    );
    if (!keep)
      await tx.execute(
        sql`delete from admin.groups where id = ${groupId}::uuid and tenant_id = ${t}::uuid`,
      );
    ch.changed({ entity: "group", tenantId: t });
    ch.audit(
      auditOf("delete", "group", {
        entityId: groupId,
        entityName: g.key,
        tenantId: t,
        before: null,
        after: null,
        summary: {
          department: null,
          group_deleted: !keep,
          before: {
            department: {
              name: g.name,
              head_user_id: g.head_user_id,
              parent_group_id: g.parent_group_id,
            },
          },
        },
      }),
    );
    return { group_deleted: !keep };
  });
}
