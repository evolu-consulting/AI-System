// ADM-FR-62 · thành viên group (spec M3 §3, M3-R03, R05): list, thêm từng phần (+ dry_run), bớt idempotent. Không
// `version`, không tăng version group/user; có đổi hàng → sự kiện `group` (bump + NOTIFY sau commit).
// Khoá (plan M3 §6): group FOR SHARE (hạng 3) → chèn group_members theo user_id TĂNG (hạng 4) → config_meta.
import {
  type GroupMember,
  type GroupMemberListQuery,
  type GroupMemberListResponse,
  type GroupMembersAddRequest,
  type GroupMembersAddResponse,
  OTHER_GROUPS_MAX,
} from "@ai/contracts";
import { type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { likeArg, pgArray } from "../../lib/sql";
import { afterLock } from "../../lib/test-hooks";
import * as repo from "./groups.repo";
import { planMemberAdd } from "./groups.rules";
import { type Call, groupRefsOf, tenantFilter } from "./groups.service";

const iso = (d: unknown) =>
  d === null || d === undefined ? null : new Date(d as string).toISOString();

type MemberRow = Record<string, unknown> & { total: number; other_groups: unknown };

function toMember(r: MemberRow): GroupMember {
  return {
    user_id: r.user_id as string,
    username: r.username as string,
    display_name: r.display_name as string,
    role: r.role as GroupMember["role"],
    status: r.active && !r.locked_by_tenant ? "active" : "locked",
    locked_by_tenant: r.locked_by_tenant as boolean,
    last_login_at: iso(r.last_login_at),
    added_at: iso(r.added_at) as string,
    added_by: (r.added_by as string | null) ?? null,
    other_groups: groupRefsOf(r.other_groups),
    other_groups_total: r.other_groups_total as number,
  };
}

async function memberRows(tx: Tx, g: { id: string; tenantId: string }, q: GroupMemberListQuery) {
  const like = q.q ? likeArg(q.q) : null;
  // `page`: lọc + sắp + cắt trang trước; other_groups/added_by chỉ tính cho ≤ limit hàng.
  return (await tx.execute(sql`
    with page as (
      select u.id, u.username, u.display_name, u.role, u.active, u.locked_by_tenant, u.last_login_at,
        m.added_at, m.added_by, count(*) over()::int as total
      from admin.group_members m join admin.users u on u.id = m.user_id
      where m.group_id = ${g.id} and m.tenant_id = ${g.tenantId}
        and (${like}::text is null or u.username ilike ${like} or u.display_name ilike ${like})
      order by u.username limit ${q.limit} offset ${q.offset})
    select p.id as user_id, p.username, p.display_name, p.role, p.active, p.locked_by_tenant, p.last_login_at,
      p.added_at, (select a.username from admin.users a where a.id = p.added_by) as added_by,
      coalesce((select json_agg(json_build_object('id', o.id, 'key', o.key, 'name', o.name)
          order by (o.key <> 'beta-testers'), o.key)
        from (select og.id, og.key, og.name from admin.group_members om join admin.groups og on og.id = om.group_id
          where om.user_id = p.id and om.group_id <> ${g.id}
          order by (og.key <> 'beta-testers'), og.key limit ${OTHER_GROUPS_MAX}) o), '[]'::json) as other_groups,
      (select count(*)::int from admin.group_members om where om.user_id = p.id and om.group_id <> ${g.id})
        as other_groups_total,
      p.total
    from page p
    order by p.username`)) as unknown as MemberRow[];
}

export function listMembers(
  c: Call,
  groupId: string,
  q: GroupMemberListQuery,
): Promise<GroupMemberListResponse> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const g = await repo.findGroup(tx, tenantFilter(c.actor), groupId);
    if (!g) throw appError("NOT_FOUND");
    const rows = await memberRows(tx, g, q);
    return { items: rows.map(toMember), total: rows[0]?.total ?? 0 };
  });
}

/** Chèn theo user_id tăng; trả id thật sự được chèn (đua thêm cùng user → DO NOTHING). */
async function insertMembers(
  tx: Tx,
  g: { id: string; tenantId: string },
  ids: string[],
  actorId: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = (await tx.execute(sql`
    insert into admin.group_members (tenant_id, group_id, user_id, added_by)
    select ${g.tenantId}, ${g.id}, x.id, ${actorId}::uuid from unnest(${pgArray(ids, "uuid")}) with ordinality as x(id, n)
    order by x.n
    on conflict (group_id, user_id) do nothing
    returning user_id`)) as unknown as { user_id: string }[];
  return new Set(rows.map((r) => r.user_id));
}

async function lookup(tx: Tx, tenantId: string, groupId: string, names: string[]) {
  const found = (await tx.execute(sql`select id, username from admin.users
    where tenant_id = ${tenantId} and username = any(${pgArray(names, "text")})`)) as unknown as {
    id: string;
    username: string;
  }[];
  const ids = found.map((f) => f.id);
  const existing = (await tx.execute(sql`select user_id from admin.group_members
    where group_id = ${groupId} and user_id = any(${pgArray(ids, "uuid")})`)) as unknown as {
    user_id: string;
  }[];
  return { found, existing: new Set(existing.map((e) => e.user_id)) };
}

/** M3-R03: không all-or-nothing; `dry_run` → cùng kết quả, không ghi, không NOTIFY. */
export function addMembers(
  c: Call,
  groupId: string,
  input: GroupMembersAddRequest,
): Promise<GroupMembersAddResponse> {
  return configWrite(c, "group.members", async (tx, ch) => {
    const g = await repo.lockGroup(tx, tenantFilter(c.actor), groupId, "share");
    if (!g) throw appError("NOT_FOUND");
    await afterLock(c.ctx.hooks, "group.members", "locked");
    const { found, existing } = await lookup(tx, g.tenantId, g.id, input.usernames);
    const plan = planMemberAdd(input.usernames, found, existing);
    const out = { added: plan.added, not_found: plan.not_found, already: plan.already };
    if (input.dry_run) return out;
    const inserted = await insertMembers(tx, g, plan.toInsert, c.actor.userId);
    if (inserted.size > 0) ch.changed({ entity: "group", tenantId: g.tenantId });
    await afterLock(c.ctx.hooks, "group.members", "rows");
    if (inserted.size === plan.toInsert.length) return out;
    const byName = new Map(found.map((f) => [f.username, f.id]));
    const raced = out.added.filter((n) => !inserted.has(byName.get(n) as string));
    const order = (n: string) => input.usernames.indexOf(n);
    const already = [...out.already, ...raced].sort((a, b) => order(a) - order(b));
    return { ...out, added: out.added.filter((n) => !raced.includes(n)), already };
  });
}

/** 204 cả khi không là thành viên (idempotent, R05); group không thấy được → 404. */
export function removeMember(c: Call, groupId: string, userId: string): Promise<void> {
  return configWrite(c, "group.members", async (tx, ch) => {
    const g = await repo.lockGroup(tx, tenantFilter(c.actor), groupId, "share");
    if (!g) throw appError("NOT_FOUND");
    await afterLock(c.ctx.hooks, "group.members", "locked");
    const rows = (await tx.execute(sql`delete from admin.group_members
      where tenant_id = ${g.tenantId} and group_id = ${g.id} and user_id = ${userId}
      returning user_id`)) as unknown as unknown[];
    if (rows.length > 0) ch.changed({ entity: "group", tenantId: g.tenantId });
    await afterLock(c.ctx.hooks, "group.members", "rows");
  });
}
