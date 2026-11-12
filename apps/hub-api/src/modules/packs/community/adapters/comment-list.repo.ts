// CR-129 · bình luận phẳng theo bài (thay "luồng" D3): danh sách có phân trang + thêm bình luận + kiểm công ty được nhắc.
// Mỗi hàm MỘT câu (Luật 4c); ai thấy bình luận do RLS `comments_visible` (0015) lọc — repo không lọc lại theo bên.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { StoredText } from "../domain/content.rules";

export type CommentRow = {
  id: string;
  author_user_id: string;
  author_name: string;
  author_org: string | null;
  text: string;
  hits: unknown[] | null;
  hidden: boolean;
  created_at: string;
  /** Id công ty được nhắc (đầy đủ; `views.ts` lọc theo người xem). */
  mentions: string[];
};

/** Cột bình luận dạng JSON (cùng một dạng cho list / insert / update returning). `a` = alias của bảng. Chủ quản: raw + hits. */
export const commentJson = (a: string): SQL =>
  sql.raw(`json_build_object('id', ${a}.id, 'author_user_id', ${a}.author_user_id,
    'author_name', ${a}.author_name, 'author_org', ${a}.author_org,
    'text', case when (select packs.viewer_ext_org()) is null then ${a}.text_raw else ${a}.text_masked end,
    'hits', case when (select packs.viewer_ext_org()) is null then ${a}.hits end,
    'hidden', ${a}.hidden, 'created_at', ${a}.created_at, 'mentions', ${a}.mention_orgs)`);

const arr = (xs: readonly string[]) => JSON.stringify(xs);

/** Một trang bình luận (cũ → mới), lấy `limit` hàng (người gọi truyền `limit + 1` để biết còn trang sau). `post = false` ⇒ không thấy bài. */
export async function listComments(
  tx: Tx,
  postId: string,
  page: { cursor: { at: string; id: string } | null; limit: number },
): Promise<{ post: boolean; comments: CommentRow[] }> {
  const at = page.cursor?.at ?? null;
  const id = page.cursor?.id ?? null;
  const rows = await tx.execute<{ r: { post: boolean; comments: CommentRow[] } }>(sql`
    select json_build_object(
      'post', exists (select 1 from community.posts p where p.id = ${postId}::uuid),
      'comments', coalesce((select json_agg(${commentJson("s")} order by s.created_at, s.id)
        from (select c.* from community.comments c where c.post_id = ${postId}::uuid
            and (${at}::timestamptz is null or (c.created_at, c.id) > (${at}::timestamptz, ${id}::uuid))
          order by c.created_at, c.id limit ${page.limit}::int) s), '[]'::json)) as r`);
  return rows[0]?.r ?? { post: false, comments: [] };
}

export type NewComment = {
  tenantId: string;
  postId: string;
  userId: string;
  authorName: string;
  authorOrg: string | null;
  text: StoredText;
  /** Công ty được nhắc (đã kiểm, không trùng). */
  mentions: readonly string[];
};

/** Thêm bình luận: MỘT câu, trả hàng vừa tạo. RLS chặn bài không thấy / sai bên / nhắc người không phải bạn (42501). */
export async function insertComment(tx: Tx, c: NewComment): Promise<CommentRow> {
  const rows = await tx.execute<{ r: CommentRow }>(sql`
    insert into community.comments as c (tenant_id, post_id, author_user_id, author_name, author_org,
      text_raw, text_masked, hits, mention_orgs)
    values (${c.tenantId}::uuid, ${c.postId}::uuid, ${c.userId}::uuid, ${c.authorName}, ${c.authorOrg}::uuid,
      ${c.text.raw}, ${c.text.masked}, ${JSON.stringify(c.text.hits)}::jsonb,
      array(select jsonb_array_elements_text(${arr(c.mentions)}::jsonb)::uuid))
    returning ${commentJson("c")} as r`);
  return rows[0]?.r as CommentRow;
}

/**
 * Trong `orgs`, công ty nào được thấy bài `postId` (cùng luật D2 của bài): bài đối tác ⇒ chỉ công ty đăng; bài chủ quản ⇒ trong
 * audience (`community.audience_ok`). Một câu theo mảng (một tham số JSON); bài không thấy ⇒ rỗng. Dùng cho `mentionables` và
 * kiểm `mentions` khi gửi (chỉ chủ quản gọi — đối tác không có ai để nhắc).
 */
export async function orgsSeeingPost(
  tx: Tx,
  tenantId: string,
  postId: string,
  orgs: readonly string[],
): Promise<string[]> {
  if (orgs.length === 0) return [];
  const rows = await tx.execute<{ org: string }>(sql`
    with o as (select jsonb_array_elements_text(${arr(orgs)}::jsonb)::uuid as id)
    select o.id::text as org
    from o join community.posts p on p.id = ${postId}::uuid and p.tenant_id = ${tenantId}::uuid
    left join contracts.community_partners(array(select id from o)) pc on pc.ext_org_id = o.id
    where case when p.author_org is not null then p.author_org = o.id
      else community.audience_ok(p.aud_mode, p.aud_cats, p.aud_orgs, p.type, p.cats, o.id,
        coalesce(pc.roles, '{}'), coalesce(pc.cats, '{}')) end`);
  return rows.map((r) => r.org);
}
