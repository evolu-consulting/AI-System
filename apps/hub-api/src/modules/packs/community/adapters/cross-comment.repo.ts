// CR-191 · BR-191-12 · bình luận CHÉO công ty (người công ty đã kết nối trên bài đối tác họ thấy). Mỗi hàm MỘT câu gọi hàm DEFINER
// community 0032 — DB kiểm lại hàng rào (kết nối hai chiều, «Ai thấy bài», bài còn hiệu lực) mỗi lần; tenant/người lấy từ GUC.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StoredText } from "../domain/content.rules";
import type { CommentRow } from "./comment-list.repo";

export type CrossPage = {
  cursor: { at: string; id: string } | null;
  limit: number;
  dir?: "asc" | "desc";
  beforeId?: string | undefined;
};

/** Một trang bình luận người xem thấy trên bài công ty kết nối. Không thấy bài ⇒ `post=false`. */
export async function crossList(
  tx: Tx,
  postId: string,
  p: CrossPage,
): Promise<{ post: boolean; comments: CommentRow[]; beforeOk: boolean }> {
  const rows = await tx.execute<{
    r: { post: boolean; before_ok: boolean; comments: CommentRow[] };
  }>(sql`
    select community.cross_comments(${postId}::uuid, ${p.cursor?.at ?? null}::timestamptz, ${p.cursor?.id ?? null}::uuid,
      ${p.limit}::int, ${p.dir === "desc"}::boolean, ${p.beforeId ?? null}::uuid) as r`);
  const r = rows[0]?.r;
  return r
    ? { post: r.post, comments: r.comments, beforeOk: r.before_ok }
    : { post: false, comments: [], beforeOk: true };
}

export type CrossAdded = {
  comment: CommentRow;
  post_tenant: string;
  /** Người được nhắc đã qua DB; `tenant` null = người của công ty đăng bài. */
  people: { id: string; name: string; tenant: string | null }[];
};

/** Thêm bình luận chéo. Không thấy bài ⇒ 42501; nhắc người ngoài công ty đăng/công ty mình ⇒ 22023. */
export async function crossAdd(
  tx: Tx,
  postId: string,
  text: StoredText,
  people: readonly { id: string; tenant: string }[],
): Promise<CrossAdded> {
  const rows = await tx.execute<{ r: CrossAdded }>(sql`
    select community.cross_comment_add(${postId}::uuid, ${text.raw}, ${text.masked}, ${JSON.stringify(text.hits)}::jsonb,
      ${JSON.stringify(people.map((x) => ({ id: x.id, tenant: x.tenant })))}::jsonb) as r`);
  return rows[0]?.r as CrossAdded;
}

/** Sửa chữ bình luận CỦA MÌNH trên bài công ty kết nối; không được ⇒ null. */
export async function crossEdit(
  tx: Tx,
  r: { postId: string; id: string; text: StoredText },
): Promise<CommentRow | null> {
  const rows = await tx.execute<{ r: CommentRow | null }>(sql`
    select community.cross_comment_edit(${r.postId}::uuid, ${r.id}::uuid, ${r.text.raw}, ${r.text.masked},
      ${JSON.stringify(r.text.hits)}::jsonb) as r`);
  return rows[0]?.r ?? null;
}

/** Xoá bình luận CỦA MÌNH trên bài công ty kết nối. `true` = đã xoá. */
export async function crossDelete(tx: Tx, r: { postId: string; id: string }): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(sql`
    select community.cross_comment_delete(${r.postId}::uuid, ${r.id}::uuid) as ok`);
  return rows[0]?.ok === true;
}

/** Tenant công ty đăng nếu người xem thấy bài qua kết nối (hàng rào DEFINER); không ⇒ null. */
export async function crossPostTenant(tx: Tx, postId: string): Promise<string | null> {
  const rows = await tx.execute<{ t: string | null }>(sql`
    select community.cross_post_tenant(${postId}::uuid)::text as t`);
  return rows[0]?.t ?? null;
}
