// CR-110 · COM-FR-37 · Luật 4c: tab "Ảnh & tệp" = MỘT câu mỗi trang. Không tự viết luật thấy bài: chạy trong tx người xem nên RLS
// `posts_visible` + `media_visible` (cùng luật bảng tin) lọc; câu chỉ thêm "bài của bên `org`" + con trỏ. Hai văn bản SQL cố định
// (chủ quản `author_org is null` / công ty `= $org`) để cả hai dùng `posts_author_org_idx (tenant_id, author_org, created_at desc)`,
// rồi `media_post_idx (post_id, position)` cho đính kèm.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

export type MediaRow = {
  id: string;
  post_id: string;
  post_type: "sell" | "buy" | "note";
  kind: "image" | "video";
  label: string;
  url: string | null;
  position: number;
  created_at: string;
};

/** Con trỏ = (giờ đăng bài, id bài, vị trí đính kèm) của hàng cuối trang trước. */
export type MediaCursor = { at: string; post: string; pos: number };

/** `org` null = bài chủ quản. Mới nhất trước; trong một bài theo thứ tự đính kèm. Trả tối đa `limit + 1` (dò trang sau). */
export async function profileMedia(
  tx: Tx,
  tenantId: string,
  org: string | null,
  cursor: MediaCursor | null,
  limit: number,
): Promise<MediaRow[]> {
  const byOrg: SQL = org === null ? sql`p.author_org is null` : sql`p.author_org = ${org}::uuid`;
  const at = cursor?.at ?? null;
  const rows = await tx.execute<MediaRow>(sql`
    select m.id, m.post_id, p.type as post_type, m.kind, m.label, m.url, m.position,
      to_json(p.created_at) #>> '{}' as created_at -- chuỗi ISO đủ micro giây: con trỏ so bằng chính xác
    from community.posts p
    join community.media m on m.post_id = p.id and m.tenant_id = p.tenant_id
    where p.tenant_id = ${tenantId}::uuid and ${byOrg}
      and (${at}::timestamptz is null
        or (p.created_at, p.id) < (${at}::timestamptz, ${cursor?.post ?? null}::uuid)
        or ((p.created_at, p.id) = (${at}::timestamptz, ${cursor?.post ?? null}::uuid)
          and m.position > ${cursor?.pos ?? 0}::int))
    order by p.created_at desc, p.id desc, m.position
    limit ${limit + 1}::int`);
  return [...rows];
}
