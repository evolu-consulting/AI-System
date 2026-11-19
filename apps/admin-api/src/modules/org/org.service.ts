// M1D-FR-02 · M1D-FR-03 · docs/specs/M1-departments: cơ cấu tổ chức của tenant — đọc một lần (thành viên + quản lý + phòng ban),
// gán/bỏ quản lý (closure + cấm vòng ở trigger DB `admin.user_managers_*`), đánh dấu Group là phòng ban + trưởng phòng.
// tenant_admin chỉ tenant mình; platform cần `?tenant_id` khi ghi. Ghi qua `configWrite` (một tx + audit).
import {
  type DepartmentSetRequest,
  type JobTitleSetRequest,
  type ManagerSetRequest,
  ORG_MEMBERS_MAX,
  type OrgMemberRow,
  type OrgMembersQuery,
  type OrgMembersResponse,
  type OrgResponse,
} from "@ai/contracts/org";
import { type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError, extOrgError } from "../../lib/errors";
import { checkViolation, foreignKeyViolation } from "../../lib/pg-errors";
import { likeArg } from "../../lib/sql";
import { assertNameFree, lockOrgTree, type OrgCall, tenantOf } from "./org.shared";

export type { OrgCall };

type OrgRow = {
  members: OrgResponse["members"] | string;
  departments: OrgResponse["departments"] | string;
};

/** CR-187 · BR-187-2: chỉ người nội bộ (đối tác không vào cơ cấu). MỘT câu: thành viên đang hoạt động (≤ ORG_MEMBERS_MAX) + quản lý, phòng ban + id thành viên. */
export function getOrg(c: OrgCall, q: string | undefined): Promise<OrgResponse> {
  const t = tenantOf(c, q, "read");
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const rows = (await tx.execute(sql`select
      coalesce((select json_agg(json_build_object('user_id', u.id, 'username', u.username,
          'display_name', u.display_name, 'manager_id', m.manager_id, 'job_title', pp.job_title) order by lower(u.display_name), u.id)
        from (select * from admin.users where tenant_id = ${t}::uuid and active and kind = 'internal'
              order by lower(display_name), id limit ${ORG_MEMBERS_MAX}::int) u
        left join admin.user_managers m on m.user_id = u.id and m.tenant_id = u.tenant_id
        left join hub.people_profiles pp on pp.user_id = u.id and pp.tenant_id = u.tenant_id), '[]'::json) as members,
      coalesce((select json_agg(json_build_object('group_id', g.id, 'key', g.key,
          'name', coalesce(g.name ->> 'vi', g.key), 'head_user_id', d.head_user_id,
          'parent_group_id', d.parent_group_id, 'member_ids', coalesce((select json_agg(gm.user_id order by gm.user_id) from admin.group_members gm
            where gm.group_id = g.id and gm.tenant_id = g.tenant_id), '[]'::json)) order by g.key)
        from admin.departments d join admin.groups g on g.id = d.group_id and g.tenant_id = d.tenant_id
        where d.tenant_id = ${t}::uuid), '[]'::json) as departments`)) as unknown as OrgRow[];
    const r = rows[0] as OrgRow;
    const parse = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
    return { members: parse(r.members), departments: parse(r.departments) };
  });
}

/** CR-151 · CR-187: chỉ người nội bộ. MỘT câu/trang: thành viên đang hoạt động (tìm tên/tên đăng nhập, limit/offset) + tên quản lý + tổng số. */
export function listOrgMembers(c: OrgCall, q: OrgMembersQuery): Promise<OrgMembersResponse> {
  const t = tenantOf(c, q.tenant_id, "read");
  const like = q.q ? likeArg(q.q) : null; // thoát `\ % _` ⇒ khớp đúng ký tự (như danh bạ thành viên)
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const rows =
      (await tx.execute(sql`select u.id as user_id, u.username, u.display_name, m.manager_id,
        mu.display_name as manager_name, pp.job_title, count(*) over()::int as total
      from admin.users u
      left join admin.user_managers m on m.user_id = u.id and m.tenant_id = u.tenant_id
      left join admin.users mu on mu.id = m.manager_id and mu.tenant_id = u.tenant_id
      left join hub.people_profiles pp on pp.user_id = u.id and pp.tenant_id = u.tenant_id
      where u.tenant_id = ${t}::uuid and u.active and u.kind = 'internal'
        and (${like}::text is null or u.display_name ilike ${like}::text or u.username ilike ${like}::text)
      order by lower(u.display_name), u.id limit ${q.limit}::int offset ${q.offset}::int`)) as unknown as (OrgMemberRow & {
        total: number;
      })[];
    return {
      items: rows.map(({ total: _t, ...m }) => m),
      total: rows[0]?.total ?? 0,
    };
  });
}

/** Gán (upsert) hoặc bỏ (null) quản lý của `userId`. User/quản lý ngoài tenant ⇒ 404; vòng ⇒ 400 `manager_cycle`; gán MỚI người không phải trưởng phòng ⇒ 400 `manager_not_head` (CR-189). */
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
          // CR-102a · com-c2 (TB-1): trigger 0029 — đối tác không quản lý/được quản lý.
          if (ck === "user_managers_internal_ck") throw extOrgError("EXTERNAL_USER_NOT_ALLOWED");
          if (ck === "user_managers_cycle_ck" || ck === "user_managers_self_ck")
            throw appError("VALIDATION_ERROR", { reason: "manager_cycle" });
          throw err;
        });
      // CR-189 BR-189-5: gán MỚI chỉ cho trưởng phòng (kiểm sau các ràng buộc khác; throw ⇒ cả tx lùi, bản ghi cũ giữ nguyên).
      // Gán lại đúng người đang là quản lý = không đổi ⇒ không kiểm (dữ liệu cũ giữ).
      if (u[0].manager_id !== input.manager_id) {
        const head = (await tx.execute(sql`select 1 from admin.departments
          where tenant_id = ${t}::uuid and head_user_id = ${input.manager_id}::uuid limit 1 for share`)) as unknown as unknown[];
        if (head.length === 0) throw appError("VALIDATION_ERROR", { reason: "manager_not_head" });
      }
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

const ORG_DEPTH_MAX = 32;

/** Cha phải là phòng ban cùng công ty (NOT_FOUND nếu không), khác chính nó và không nằm dưới nó (400 `dept_cycle`). */
async function assertParentOk(tx: Tx, t: string, groupId: string, parent: string): Promise<void> {
  if (parent === groupId) throw appError("VALIDATION_ERROR", { reason: "dept_cycle" });
  // Leo từ cha lên gốc trong MỘT câu; gặp `groupId` ⇒ vòng. `found` = cha có là phòng ban của công ty.
  const r = (await tx.execute(sql`with recursive up(id, depth) as (
      select ${parent}::uuid, 0
      union all
      select d.parent_group_id, up.depth + 1 from up join admin.departments d
        on d.group_id = up.id and d.tenant_id = ${t}::uuid
      where d.parent_group_id is not null and up.depth < ${ORG_DEPTH_MAX}::int)
    select exists(select 1 from admin.departments where group_id = ${parent}::uuid and tenant_id = ${t}::uuid) as found,
      exists(select 1 from up where id = ${groupId}::uuid) as cycle,
      exists(select 1 from up join admin.departments d on d.group_id = up.id and d.tenant_id = ${t}::uuid
        where up.depth = ${ORG_DEPTH_MAX}::int and d.parent_group_id is not null) as too_deep`)) as unknown as {
    found: boolean;
    cycle: boolean;
    too_deep: boolean;
  }[];
  if (!r[0]?.found) throw appError("NOT_FOUND");
  if (r[0].cycle) throw appError("VALIDATION_ERROR", { reason: "dept_cycle" });
  // Chuỗi cha dài quá giới hạn dò ⇒ không chắc có vòng ⇒ không cho qua.
  if (r[0].too_deep) throw appError("VALIDATION_ERROR", { reason: "dept_too_deep" });
}

/** Chèn/cập nhật hàng phòng ban (trưởng phòng; phòng cha chỉ đổi khi `setParent`). FK/trigger → mã lỗi nghiệp vụ. */
async function upsertDepartment(
  tx: Tx,
  t: string,
  d: { groupId: string; input: DepartmentSetRequest; parent: string | null; setParent: boolean },
): Promise<void> {
  const { groupId, input, parent, setParent } = d;
  await tx
    .transaction((sp) =>
      sp.execute(sql`insert into admin.departments (tenant_id, group_id, head_user_id, parent_group_id)
        values (${t}::uuid, ${groupId}::uuid, ${input.head_user_id}::uuid, ${parent}::uuid)
        on conflict (group_id) do update set head_user_id = excluded.head_user_id,
          parent_group_id = case when ${setParent} then excluded.parent_group_id else admin.departments.parent_group_id end,
          updated_at = now()`),
    )
    .catch((err) => {
      if (foreignKeyViolation(err) === "departments_head_fk") throw appError("NOT_FOUND");
      // CR-102a · com-c2 (TB-1): trigger 0029 — đối tác không làm trưởng phòng.
      if (checkViolation(err) === "departments_head_internal_ck")
        throw extOrgError("EXTERNAL_USER_NOT_ALLOWED");
      throw err;
    });
}

/**
 * Đánh dấu Group là phòng ban (upsert trưởng phòng, phòng cha). Xoá phòng KHÔNG ở đây (CR-189: `deleteDept` — chặn khi còn
 * người/phòng con). Đổi sang phòng cha có phòng trùng tên (không phân hoa/thường) ⇒ 409 `NAME_TAKEN`.
 */
export function setDepartment(
  c: OrgCall,
  q: string | undefined,
  groupId: string,
  input: DepartmentSetRequest,
): Promise<{ group_id: string; head_user_id: string | null }> {
  const t = tenantOf(c, q, "write");
  return configWrite(c, "group.save", async (tx, ch) => {
    // CR-139d · khoá theo công ty ĐẦU TIÊN (thứ tự khoá ở org.shared): hai lần đổi cha song song không cùng lúc qua kiểm tra vòng.
    await lockOrgTree(tx, t);
    const g =
      (await tx.execute(sql`select g.key, g.name ->> 'vi' as name, d.head_user_id, d.parent_group_id, d.group_id is not null as dept
      from admin.groups g left join admin.departments d on d.group_id = g.id and d.tenant_id = g.tenant_id
      where g.id = ${groupId}::uuid and g.tenant_id = ${t}::uuid for no key update of g`)) as unknown as {
        key: string;
        name: string;
        head_user_id: string | null;
        parent_group_id: string | null;
        dept: boolean;
      }[];
    if (!g[0]) throw appError("NOT_FOUND");
    const setParent = input.parent_group_id !== undefined;
    const parent = input.parent_group_id ?? null;
    if (parent !== null) await assertParentOk(tx, t, groupId, parent);
    // Tên trùng cùng cấp chỉ kiểm khi vị trí đổi (phòng cũ trùng tên sẵn không bị chặn khi chỉ đổi trưởng phòng).
    const newParent = setParent ? parent : g[0].parent_group_id;
    if (!g[0].dept || newParent !== g[0].parent_group_id)
      await assertNameFree(tx, t, { name: g[0].name, parent: newParent, except: groupId });
    await upsertDepartment(tx, t, { groupId, input, parent, setParent });
    ch.changed({ entity: "group", tenantId: t });
    ch.audit(
      auditOf("update", "group", {
        entityId: groupId,
        entityName: g[0].key,
        tenantId: t,
        before: null,
        after: null,
        summary: {
          department: { head_user_id: input.head_user_id, parent_group_id: input.parent_group_id },
          before: {
            department: g[0].dept
              ? { head_user_id: g[0].head_user_id, parent_group_id: g[0].parent_group_id }
              : null,
          },
        },
      }),
    );
    return { group_id: groupId, head_user_id: input.head_user_id };
  });
}

/**
 * CR-147b ý 9 · chức vụ nhân viên (quản trị công ty nhập ở «Cơ cấu»; hiện ở hồ sơ cá nhân + thẻ người `/people`). Lưu ở
 * `hub.people_profiles.job_title` (admin_rw chỉ có quyền cột này). User ngoài tenant ⇒ 404; null/rỗng ⇒ xoá.
 */
export function setJobTitle(
  c: OrgCall,
  q: string | undefined,
  userId: string,
  input: JobTitleSetRequest,
): Promise<{ user_id: string; job_title: string | null }> {
  const t = tenantOf(c, q, "write");
  return configWrite(c, "group.save", async (tx, ch) => {
    const u = (await tx.execute(sql`select u.username, pp.job_title from admin.users u
      left join hub.people_profiles pp on pp.user_id = u.id and pp.tenant_id = u.tenant_id
      where u.id = ${userId}::uuid and u.tenant_id = ${t}::uuid for no key update of u`)) as unknown as {
      username: string;
      job_title: string | null;
    }[];
    if (!u[0]) throw appError("NOT_FOUND");
    await tx.execute(sql`insert into hub.people_profiles (tenant_id, user_id, job_title)
      values (${t}::uuid, ${userId}::uuid, ${input.job_title})
      on conflict (tenant_id, user_id) do update set job_title = excluded.job_title, updated_at = now()`);
    ch.changed({ entity: "user", tenantId: t });
    ch.audit(
      auditOf("update", "user", {
        entityId: userId,
        entityName: u[0].username,
        tenantId: t,
        before: null,
        after: null,
        summary: { job_title: input.job_title, before: { job_title: u[0].job_title } },
      }),
    );
    return { user_id: userId, job_title: input.job_title };
  });
}
