// CR-148 · danh bạ «Thành viên» của Tin nhắn, TẢI DẦN (thay `internalDirectory` của CR-132b, G1): nhân viên NỘI BỘ còn dùng được của CHÍNH công ty,
// trừ người gọi, sắp theo phòng ban (người chưa có phòng ở cuối) rồi tên. MỘT câu mỗi trang (lấy `limit + 1` để biết còn trang sau).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";

export type DirectoryEntry = {
  id: string;
  name: string;
  department: { id: string; name: string } | null;
};
export type DirectoryPage = { items: DirectoryEntry[]; next_cursor: string | null };
type Key = [number, string, string, string];

/** Con trỏ = khoá sắp xếp của dòng cuối [chưa-có-phòng 0/1, tên phòng, tên, id] (base64url JSON). */
export const encodeDirCursor = (k: Key): string =>
  Buffer.from(JSON.stringify(k)).toString("base64url");

export function decodeDirCursor(s: string): Key | null {
  try {
    const k = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    const ok =
      Array.isArray(k) &&
      k.length === 4 &&
      (k[0] === 0 || k[0] === 1) &&
      typeof k[1] === "string" &&
      typeof k[2] === "string" &&
      typeof k[3] === "string" &&
      /^[0-9a-f-]{36}$/i.test(k[3]);
    return ok ? (k as Key) : null;
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  name: string;
  k1: number;
  k2: string;
  dept_id: string | null;
  dept_name: string | null;
};

/** `q` lọc tên không dấu (`unaccent`). Đối tác (external) ⇒ rỗng; công ty khác không bao giờ lọt vào. `cursor` hỏng ⇒ ném `BAD_CURSOR`. */
export const internalDirectoryPage =
  (db: Db) =>
  async (
    who: { tenantId: string; userId: string; userKind?: "internal" | "external" },
    opt: { cursor?: string | undefined; limit: number; q?: string | undefined },
  ): Promise<DirectoryPage> => {
    if (who.userKind === "external") return { items: [], next_cursor: null };
    const cur = opt.cursor ? decodeDirCursor(opt.cursor) : null;
    if (opt.cursor && !cur) throw new Error("BAD_CURSOR");
    const q = (opt.q ?? "").trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const after = cur
      ? sql`and (x.k1, x.k2, x.name, x.id::text) > (${cur[0]}::int, ${cur[1]}::text, ${cur[2]}::text, ${cur[3]}::text)`
      : sql``;
    const like = q
      ? sql`and unaccent(lower(x.name)) like '%' || unaccent(lower(${q}::text)) || '%'`
      : sql``;
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      (tx) =>
        tx.execute<Row>(sql`select * from (
            select u.id, u.display_name as name, (d.name is null)::int as k1, coalesce(d.name, '') as k2,
                   d.group_id as dept_id, d.name as dept_name
            from admin.users u
            left join lateral (
              select g.id as group_id, coalesce(g.name ->> 'vi', g.key) as name
              from admin.group_members gm
              join admin.departments dp on dp.group_id = gm.group_id and dp.tenant_id = gm.tenant_id
              join admin.groups g on g.id = gm.group_id and g.tenant_id = gm.tenant_id
              where gm.user_id = u.id and gm.tenant_id = u.tenant_id
              order by g.key limit 1) d on true
            where u.tenant_id = ${who.tenantId}::uuid and u.kind = 'internal'
              and u.active and not u.locked_by_tenant and u.id <> ${who.userId}::uuid) x
          where true ${after} ${like}
          order by x.k1, x.k2, x.name, x.id::text limit ${opt.limit + 1}::int`),
    );
    const page = rows.slice(0, opt.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        name: r.name,
        department: r.dept_id && r.dept_name ? { id: r.dept_id, name: r.dept_name } : null,
      })),
      next_cursor:
        rows.length > opt.limit && last
          ? encodeDirCursor([last.k1, last.k2, last.name, last.id])
          : null,
    };
  };
