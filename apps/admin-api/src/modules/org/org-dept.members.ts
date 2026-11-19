// CR-189 · BR-189-6 · thành viên phòng ban trên sơ đồ — «mỗi người một phòng» đặt Ở SERVICE (không trigger DB, Q5):
//  - thêm vào phòng X: người đang ở phòng khác ⇒ CHUYỂN (rời mọi phòng ban khác, kể cả khi vốn ở nhiều phòng);
//  - bỏ khỏi phòng X ⇒ về phòng cha (phòng cấp trên cùng ⇒ về công ty), trừ khi người đó vẫn ở phòng ban khác;
//  - trưởng phòng của phòng KHÁC không chuyển được, trưởng phòng của chính X không bỏ được ⇒ 409 `MEMBER_IS_HEAD`.
// Chỉ đụng `group_members` của Group là phòng ban (Group quyền/vai/beta không phải phòng ban thì giữ nguyên). Group vẫn
// mang `feature_grants` ⇒ chuyển người có thể đổi quyền: mỗi lời gọi trả `access {gained, lost}` (số cặp người×tính năng
// do nhóm cấp; cấp trực tiếp cho người không đổi) để màn hình báo trước/sau. Khoá theo thứ tự ở `org.shared.ts`.
import type {
  DeptMemberRemoveResponse,
  DeptMembersAddRequest,
  DeptMembersAddResponse,
  OrgAccessChange,
} from "@ai/contracts/org";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf } from "../../lib/audit/audit.write";
import { type ConfigSink, configWrite } from "../../lib/config/config-write";
import { appError, extOrgError, orgDeptError } from "../../lib/errors";
import { pgArray } from "../../lib/sql";
import { lockOrgTree, type OrgCall, tenantOf } from "./org.shared";

type Pair = { user_id: string; group_id: string };

/** Phòng ban `groupId` của công ty (404 nếu không phải) + khoá group đó và phòng cha (FOR SHARE) theo id TĂNG. */
async function lockDeptGroups(
  tx: Tx,
  t: string,
  groupId: string,
): Promise<{ key: string; head_user_id: string | null; parent_group_id: string | null }> {
  const d = (await tx.execute(sql`select g.key, d.head_user_id, d.parent_group_id
    from admin.groups g join admin.departments d on d.group_id = g.id and d.tenant_id = g.tenant_id
    where g.id = ${groupId}::uuid and g.tenant_id = ${t}::uuid`)) as unknown as {
    key: string;
    head_user_id: string | null;
    parent_group_id: string | null;
  }[];
  if (!d[0]) throw appError("NOT_FOUND");
  const ids = d[0].parent_group_id ? [groupId, d[0].parent_group_id] : [groupId];
  await tx.execute(sql`select id from admin.groups where tenant_id = ${t}::uuid and id = any(${pgArray(ids, "uuid")})
    order by id for share`);
  return d[0];
}

/** Người nội bộ đang hoạt động của công ty, khoá KEY SHARE theo id TĂNG. Thiếu/ngoài công ty/đã khoá ⇒ 404; đối tác ⇒ 422. */
async function lockUsers(tx: Tx, t: string, ids: string[]): Promise<Map<string, string>> {
  const rows = (await tx.execute(sql`select id, username, kind, active from admin.users
    where tenant_id = ${t}::uuid and id = any(${pgArray(ids, "uuid")}) order by id for key share`)) as unknown as {
    id: string;
    username: string;
    kind: string;
    active: boolean;
  }[];
  if (rows.length !== ids.length || rows.some((r) => !r.active)) throw appError("NOT_FOUND");
  const ext = rows.filter((r) => r.kind === "external").map((r) => r.username);
  if (ext.length > 0) throw extOrgError("EXTERNAL_USER_NOT_ALLOWED", { usernames: ext });
  return new Map(rows.map((r) => [r.id, r.username]));
}

/** Ngữ cảnh một giao dịch ghi (đã khoá cơ cấu công ty). */
type W = { tx: Tx; ch: ConfigSink; t: string; actorId: string; names: Map<string, string> };

/** Các phòng ban (hàng phòng ban của công ty) mà những người này đang ở; khoá hàng `group_members` theo (group, user) TĂNG. */
async function deptMemberships(tx: Tx, t: string, ids: string[]): Promise<Pair[]> {
  return (await tx.execute(sql`select gm.user_id, gm.group_id
    from admin.group_members gm join admin.departments d on d.group_id = gm.group_id and d.tenant_id = gm.tenant_id
    where gm.tenant_id = ${t}::uuid and gm.user_id = any(${pgArray(ids, "uuid")})
    order by gm.group_id, gm.user_id for update of gm`)) as unknown as Pair[];
}

const col = (p: Pair[], k: keyof Pair) =>
  pgArray(
    p.map((x) => x[k]),
    "uuid",
  );

/**
 * Quyền do nhóm cấp đổi bao nhiêu nếu gỡ `rem` và thêm `add` (cặp người×nhóm). TÍNH TRƯỚC khi ghi. Một câu, tập hợp:
 * trước = tính năng từ MỌI nhóm hiện tại của người; sau = trước trừ nhóm rời, cộng nhóm đến.
 */
async function accessDelta(
  w: W,
  users: string[],
  rem: Pair[],
  add: Pair[],
): Promise<OrgAccessChange> {
  if (rem.length === 0 && add.length === 0) return { gained: 0, lost: 0 };
  const r =
    (await w.tx.execute(sql`with rem as (select * from unnest(${col(rem, "user_id")}, ${col(rem, "group_id")}) as x(user_id, group_id)),
      add as (select * from unnest(${col(add, "user_id")}, ${col(add, "group_id")}) as x(user_id, group_id)),
      cur as (select gm.user_id, gm.group_id, fg.feature_id
        from admin.group_members gm join admin.feature_grants fg on fg.group_id = gm.group_id and fg.tenant_id = gm.tenant_id
        where gm.tenant_id = ${w.t}::uuid and gm.user_id = any(${pgArray(users, "uuid")})),
      bef as (select distinct user_id, feature_id from cur),
      aft as (select c.user_id, c.feature_id from cur c
          where not exists (select 1 from rem x where x.user_id = c.user_id and x.group_id = c.group_id)
        union select a.user_id, fg.feature_id from add a
          join admin.feature_grants fg on fg.group_id = a.group_id and fg.tenant_id = ${w.t}::uuid)
    select (select count(*)::int from bef b where not exists
        (select 1 from aft a where a.user_id = b.user_id and a.feature_id = b.feature_id)) as lost,
      (select count(*)::int from aft a where not exists
        (select 1 from bef b where a.user_id = b.user_id and a.feature_id = b.feature_id)) as gained`)) as unknown as OrgAccessChange[];
  return r[0] as OrgAccessChange;
}

async function deleteMemberships(w: W, rem: Pair[]): Promise<void> {
  if (rem.length === 0) return;
  await w.tx.execute(sql`delete from admin.group_members gm
    using unnest(${col(rem, "user_id")}, ${col(rem, "group_id")}) as x(user_id, group_id)
    where gm.tenant_id = ${w.t}::uuid and gm.user_id = x.user_id and gm.group_id = x.group_id`);
}

async function insertMemberships(w: W, groupId: string, users: string[]): Promise<void> {
  if (users.length === 0) return;
  await w.tx.execute(sql`insert into admin.group_members (tenant_id, group_id, user_id, added_by)
    select ${w.t}::uuid, ${groupId}::uuid, x.id, ${w.actorId}::uuid from unnest(${pgArray(users, "uuid")}) with ordinality as x(id, n)
    order by x.n on conflict (group_id, user_id) do nothing`);
}

async function keysOf(tx: Tx, t: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = (await tx.execute(sql`select id, key from admin.groups
    where tenant_id = ${t}::uuid and id = any(${pgArray(ids, "uuid")}) order by id`)) as unknown as {
    id: string;
    key: string;
  }[];
  return new Map(r.map((x) => [x.id, x.key]));
}

/** Một hàng audit `update · group` cho mỗi phòng đổi thành viên (`summary.added|removed` = tên đăng nhập, như `/admin/groups`). */
function auditMembers(
  w: W,
  g: { id: string; key: string },
  summary: { added: string[] } | { removed: string[] },
): void {
  w.ch.audit(
    auditOf("update", "group", {
      entityId: g.id,
      entityName: g.key,
      tenantId: w.t,
      before: null,
      after: null,
      summary,
    }),
  );
}

/** Trưởng phòng của một phòng KHÁC `groupId` không thêm/chuyển được ⇒ 409 `MEMBER_IS_HEAD` (cả lô lùi). */
async function assertNotOtherHeads(w: W, ids: string[], groupId: string): Promise<void> {
  const heads = (await w.tx.execute(sql`select head_user_id, group_id from admin.departments
    where tenant_id = ${w.t}::uuid and head_user_id = any(${pgArray(ids, "uuid")}) and group_id <> ${groupId}::uuid`)) as unknown as {
    head_user_id: string;
    group_id: string;
  }[];
  if (heads.length === 0) return;
  throw orgDeptError("MEMBER_IS_HEAD", {
    user_ids: [...new Set(heads.map((h) => h.head_user_id))],
    group_ids: [...new Set(heads.map((h) => h.group_id))],
  });
}

/** Audit cho phòng đích (vào) + từng phòng cũ (rời) của lô chuyển. */
async function auditMove(
  w: W,
  g: { id: string; key: string },
  add: string[],
  rem: Pair[],
): Promise<void> {
  if (add.length > 0) auditMembers(w, g, { added: add.map((u) => w.names.get(u) as string) });
  const fromKeys = await keysOf(w.tx, w.t, [...new Set(rem.map((m) => m.group_id))]);
  for (const [gid, key] of fromKeys) {
    const removed = rem
      .filter((m) => m.group_id === gid)
      .map((m) => w.names.get(m.user_id) as string);
    auditMembers(w, { id: gid, key }, { removed });
  }
}

/** Thêm (chuyển) người vào phòng. Cả lô hoặc không gì cả; lỗi ⇒ giao dịch lùi. */
export function addDeptMembers(
  c: OrgCall,
  q: string | undefined,
  groupId: string,
  input: DeptMembersAddRequest,
): Promise<DeptMembersAddResponse> {
  const t = tenantOf(c, q, "write");
  const ids = [...new Set(input.user_ids)].sort();
  return configWrite(c, "group.members", async (tx, ch) => {
    await lockOrgTree(tx, t);
    const g = await lockDeptGroups(tx, t, groupId);
    const w: W = { tx, ch, t, actorId: c.actor.userId, names: await lockUsers(tx, t, ids) };
    await assertNotOtherHeads(w, ids, groupId);
    const cur = await deptMemberships(tx, t, ids);
    const already = new Set(cur.filter((m) => m.group_id === groupId).map((m) => m.user_id));
    const rem = cur.filter((m) => m.group_id !== groupId);
    const add = ids.filter((u) => !already.has(u));
    const access = await accessDelta(
      w,
      ids,
      rem,
      add.map((u) => ({ user_id: u, group_id: groupId })),
    );
    await deleteMemberships(w, rem);
    await insertMemberships(w, groupId, add);
    if (add.length > 0 || rem.length > 0) ch.changed({ entity: "group", tenantId: t });
    await auditMove(w, { id: groupId, key: g.key }, add, rem);
    const moved = [...new Set(rem.map((m) => m.user_id))].map((u) => ({
      user_id: u,
      from_group_ids: rem.filter((m) => m.user_id === u).map((m) => m.group_id),
    }));
    return {
      group_id: groupId,
      added: add,
      already: ids.filter((u) => already.has(u)),
      moved,
      access,
    };
  });
}

/** Phòng đưa người về khi bỏ khỏi `groupId`: phòng cha, trừ khi người vẫn còn ở phòng ban khác (dữ liệu cũ nhiều phòng) ⇒ không kéo thêm. */
const returnTo = (parent: string | null, cur: Pair[], groupId: string): string | null =>
  cur.some((m) => m.group_id !== groupId) ? null : parent;

/** Bỏ người khỏi phòng ⇒ về phòng cha (hoặc về công ty). Không phải thành viên ⇒ không đổi gì (`removed: false`). */
export function removeDeptMember(
  c: OrgCall,
  q: string | undefined,
  groupId: string,
  userId: string,
): Promise<DeptMemberRemoveResponse> {
  const t = tenantOf(c, q, "write");
  return configWrite(c, "group.members", async (tx, ch) => {
    await lockOrgTree(tx, t);
    const g = await lockDeptGroups(tx, t, groupId);
    const w: W = { tx, ch, t, actorId: c.actor.userId, names: await lockUsers(tx, t, [userId]) };
    const cur = await deptMemberships(tx, t, [userId]);
    const none = { group_id: groupId, user_id: userId, removed: false, moved_to_group_id: null };
    if (!cur.some((m) => m.group_id === groupId))
      return { ...none, access: { gained: 0, lost: 0 } };
    if (g.head_user_id === userId)
      throw orgDeptError("MEMBER_IS_HEAD", { user_ids: [userId], group_ids: [groupId] });
    const to = returnTo(g.parent_group_id, cur, groupId);
    const rem: Pair[] = [{ user_id: userId, group_id: groupId }];
    const access = await accessDelta(
      w,
      [userId],
      rem,
      to ? [{ user_id: userId, group_id: to }] : [],
    );
    await deleteMemberships(w, rem);
    if (to) await insertMemberships(w, to, [userId]);
    ch.changed({ entity: "group", tenantId: t });
    const dest = to
      ? { id: to, key: (await keysOf(tx, t, [to])).get(to) as string }
      : { id: groupId, key: g.key };
    await auditMove(w, dest, to ? [userId] : [], rem);
    return { ...none, removed: true, moved_to_group_id: to, access };
  });
}
