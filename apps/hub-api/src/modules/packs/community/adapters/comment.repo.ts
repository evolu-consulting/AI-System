// CR-102 · C6 · CR-129 · sửa / xoá / ẩn bình luận. Mỗi hàm MỘT câu; RLS lọc hàng (đối tác chỉ chạm bình luận của mình), 0 hàng ⇒ null.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StoredText } from "../domain/content.rules";
import { type CommentRow, commentJson } from "./comment-list.repo";

type Id = { postId: string; id: string };
const first = (rows: { r: CommentRow }[]): CommentRow | null => rows[0]?.r ?? null;

/** Sửa chữ của chính người viết (lời nhắc bất biến — trigger `comments_fixed`). Trả bình luận sau sửa hoặc null. */
export async function editComment(
  tx: Tx,
  c: Id & { userId: string; text: StoredText },
): Promise<CommentRow | null> {
  return first(
    await tx.execute<{ r: CommentRow }>(sql`
      update community.comments c set text_raw = ${c.text.raw}, text_masked = ${c.text.masked},
        hits = ${JSON.stringify(c.text.hits)}::jsonb
      where c.id = ${c.id}::uuid and c.post_id = ${c.postId}::uuid and c.author_user_id = ${c.userId}::uuid
      returning ${commentJson("c")} as r`),
  );
}

/** Xoá bình luận của chính người viết. `true` = đã xoá. */
export async function deleteComment(tx: Tx, c: Id & { userId: string }): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    delete from community.comments
    where id = ${c.id}::uuid and post_id = ${c.postId}::uuid and author_user_id = ${c.userId}::uuid
    returning id`);
  return rows.length > 0;
}

/** Chủ quản ẩn/hiện bình luận bất kỳ trên bài CỦA MÌNH (author_org null). */
export async function hideComment(tx: Tx, c: Id & { hidden: boolean }): Promise<CommentRow | null> {
  return first(
    await tx.execute<{ r: CommentRow }>(sql`
      update community.comments c set hidden = ${c.hidden}::boolean
      where c.id = ${c.id}::uuid and c.post_id = ${c.postId}::uuid
        and exists (select 1 from community.posts p where p.id = ${c.postId}::uuid and p.author_org is null)
      returning ${commentJson("c")} as r`),
  );
}
