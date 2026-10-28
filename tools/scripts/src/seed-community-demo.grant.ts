// com-prod-seed · `--grant-owner` / `--grant-editor` của seed-community-demo: đưa user NỘI BỘ của tenant vào Group
// `community-owner` / `community-editor` (do enablePack tạo). Như ensureOwnerInGroup: một configWrite (audit `membersAudit` +
// config_changed để Hub nạp lại), actor = HỆ THỐNG (actor_id null). Idempotent (đã là thành viên ⇒ bỏ qua); user ngoài (đối tác)
// ⇒ TỪ CHỐI cả lô (đúng luật CR-102a của admin addMembers); user không có ⇒ lỗi. Không in/ghi mật khẩu.
import { type Db, withConfigWrite, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { publishConfigChanged } from "../../../apps/admin-api/src/lib/config/config-write";
import { pgArray } from "../../../apps/admin-api/src/lib/sql";
import { membersAudit } from "../../../apps/admin-api/src/modules/groups/groups.service";

export const EDITOR_GROUP = "community-editor";
export const OWNER_GROUP_KEY = "community-owner";

/** "a, b,,a" ⇒ ["a","b"] (cắt khoảng trắng, bỏ rỗng/trùng). Thiếu giá trị (undefined hoặc cờ kế tiếp) ⇒ lỗi. */
export function parseUserList(flag: string, v: string | undefined): string[] {
  if (v === undefined || v.startsWith("--"))
    throw new Error(`seed-community-demo: ${flag} cần danh sách username (a,b,...)`);
  const names = [
    ...new Set(
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (names.length === 0) throw new Error(`seed-community-demo: ${flag} rỗng`);
  return names;
}

/** Lỗi lô: user ngoài / không tồn tại (thuần, để test). */
export function checkGrantTargets(
  found: readonly { username: string; kind: string }[],
  wanted: readonly string[],
): string | null {
  const ext = found.filter((f) => f.kind !== "internal").map((f) => f.username);
  if (ext.length) return `từ chối user ngoài (đối tác) vào nhóm: ${ext.join(", ")}`;
  const have = new Set(found.map((f) => f.username));
  const miss = wanted.filter((w) => !have.has(w));
  return miss.length ? `không có user nội bộ: ${miss.join(", ")}` : null;
}

type Row = { id: string; username: string; kind: string; member: boolean };

/** Thêm `usernames` vào Group `groupKey` của tenant; trả username mới thêm (đã có ⇒ không nằm trong kết quả). */
export async function grantGroup(
  db: Db,
  tenantKey: string,
  groupKey: string,
  usernames: readonly string[],
): Promise<string[]> {
  const info = await withScope(db, { kind: "platform" }, async (tx) => {
    const [g] = (await tx.execute(sql`select t.id as tid, g.id as gid
      from admin.tenants t join admin.groups g on g.tenant_id = t.id and g.key = ${groupKey}
      where t.key = ${tenantKey}`)) as unknown as { tid: string; gid: string }[];
    if (!g) return null;
    const rows = (await tx.execute(sql`select u.id, u.username, u.kind,
        exists (select 1 from admin.group_members m where m.group_id = ${g.gid}::uuid and m.user_id = u.id) as member
      from admin.users u
      where u.tenant_id = ${g.tid}::uuid and u.username = any(${pgArray([...usernames], "text")})`)) as unknown as Row[];
    return { ...g, rows };
  });
  if (!info)
    throw new Error(`seed-community-demo: thiếu Group ${groupKey} (gói community chưa bật?)`);
  const bad = checkGrantTargets(info.rows, usernames);
  if (bad) throw new Error(`seed-community-demo: ${bad}`);
  const todo = info.rows.filter((r) => !r.member);
  if (todo.length === 0) return [];
  const w = await withConfigWrite(
    db,
    { kind: "platform" },
    async (tx, ch) => {
      const ids = todo.map((r) => r.id);
      await tx.execute(sql`insert into admin.group_members (tenant_id, group_id, user_id, added_by)
        select ${info.tid}::uuid, ${info.gid}::uuid, x, null
        from unnest(${pgArray(ids, "uuid")}) as x
        order by x on conflict do nothing`);
      ch.changed({ entity: "group", tenantId: info.tid });
      ch.audit(
        membersAudit(
          { id: info.gid, tenantId: info.tid, key: groupKey },
          { added: todo.map((r) => r.username) },
        ),
      );
    },
    { actorId: null },
  );
  if (w.version !== null) await publishConfigChanged(db, w.version, w.events);
  return todo.map((r) => r.username);
}
