// CR-102 · com-c9 · chuông của MỘT gói cho CHÍNH người dùng (đọc/đánh dấu đã đọc, lọc `source = <gói>`). Gói không đọc bảng hub
// (D-06) nên kit đọc hộ qua scope `user` (RLS tenant + user), MỘT câu mỗi lời gọi. Ghi thông báo vẫn chỉ qua `notify.enqueue`.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { PackWho } from "../application/ports";

export type BellRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read: boolean;
};
export type PackBell = {
  /** Mới nhất trước (≤ `limit`) + số chưa đọc của gói. */
  list(who: PackWho, limit: number): Promise<{ items: BellRow[]; unread: number }>;
  /** `id` vắng ⇒ đọc hết của gói. Trả số dòng đổi. */
  markRead(who: PackWho, id?: string): Promise<number>;
};

const scope = (w: PackWho) => ({ kind: "user", tenantId: w.tenantId, userId: w.userId }) as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function packBell(db: Db, source: string): PackBell {
  return {
    async list(who, limit) {
      const rows = await withHubScope(db, scope(who), (tx) =>
        tx.execute<BellRow & { unread: number }>(sql`
          with l as (select n.id::text as id, n.kind, n.title, n.body, n.link, n.created_at, n.seq,
              (n.read_at is not null) as read
            from hub.notifications n
            where n.tenant_id = ${who.tenantId}::uuid and n.user_id = ${who.userId}::uuid and n.source = ${source}
            order by n.seq desc limit ${limit}::int)
          select l.id, l.kind, l.title, l.body, l.link, l.created_at, l.read,
            (select count(*)::int from hub.notifications u where u.tenant_id = ${who.tenantId}::uuid
              and u.user_id = ${who.userId}::uuid and u.source = ${source} and u.read_at is null) as unread
          from l order by l.seq desc`),
      );
      const unread = rows[0] ? Number(rows[0].unread) : 0; // sổ trống ⇒ 0
      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          link: r.link,
          created_at: new Date(r.created_at).toISOString(),
          read: r.read,
        })),
        unread,
      };
    },
    async markRead(who, id) {
      if (id !== undefined && !UUID.test(id)) return 0;
      const rows = await withHubScope(db, scope(who), (tx) =>
        tx.execute<{ id: string }>(sql`
          update hub.notifications n set read_at = now()
          where n.tenant_id = ${who.tenantId}::uuid and n.user_id = ${who.userId}::uuid and n.source = ${source}
            and n.read_at is null and (${id ?? null}::uuid is null or n.id = ${id ?? null}::uuid)
          returning n.id`),
      );
      return rows.length;
    },
  };
}
