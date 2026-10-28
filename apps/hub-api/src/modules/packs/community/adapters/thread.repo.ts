// CR-102 · com-c3 · D3 · luồng bình luận riêng (bài × công ty đối tác). RLS lọc: đối tác chỉ luồng của công ty mình, không
// bình luận ẩn; chủ quản tất cả. Mỗi hàm MỘT câu.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StoredText } from "../domain/content.rules";

export type ThreadSumRow = { org: string; count: number; last: string | null };

/** Tóm tắt các luồng của bài (RLS lọc). `post = null` ⇒ không thấy bài. */
export async function threadSummaries(
  tx: Tx,
  postId: string,
): Promise<{ post: { author_org: string | null } | null; threads: ThreadSumRow[] }> {
  const rows = await tx.execute<{
    r: { post: { author_org: string | null } | null; threads: ThreadSumRow[] };
  }>(sql`
    select json_build_object(
      'post', (select json_build_object('author_org', p.author_org) from community.posts p where p.id = ${postId}::uuid),
      'threads', coalesce((select json_agg(json_build_object('org', t.ext_org_id, 'count', s.n, 'last', s.last)
          order by t.last_at desc)
        from community.threads t
        cross join lateral (select count(*)::int as n, max(c.created_at) as last from community.comments c
          where c.thread_id = t.id) s
        where t.post_id = ${postId}::uuid), '[]'::json)) as r`);
  return rows[0]?.r ?? { post: null, threads: [] };
}

export type CommentRow = {
  id: string;
  author_user_id: string;
  author_name: string;
  author_org: string | null;
  text: string;
  hits: unknown[] | null;
  hidden: boolean;
  created_at: string;
};

/** Bình luận của luồng (cũ → mới). `post = false` ⇒ không thấy bài. */
export async function threadComments(
  tx: Tx,
  postId: string,
  org: string,
): Promise<{ post: boolean; comments: CommentRow[] }> {
  const rows = await tx.execute<{ r: { post: boolean; comments: CommentRow[] } }>(sql`
    select json_build_object(
      'post', exists (select 1 from community.posts p where p.id = ${postId}::uuid),
      'comments', coalesce((select json_agg(json_build_object('id', c.id, 'author_user_id', c.author_user_id,
          'author_name', c.author_name, 'author_org', c.author_org,
          'text', case when (select packs.viewer_ext_org()) is null then c.text_raw else c.text_masked end,
          'hits', case when (select packs.viewer_ext_org()) is null then c.hits end, 'hidden', c.hidden, 'created_at', c.created_at)
          order by c.created_at, c.id)
        from community.comments c where c.post_id = ${postId}::uuid and c.thread_org = ${org}::uuid), '[]'::json)) as r`);
  return rows[0]?.r ?? { post: false, comments: [] };
}

export type NewComment = {
  tenantId: string;
  postId: string;
  threadOrg: string;
  userId: string;
  authorName: string;
  authorOrg: string | null;
  text: StoredText;
};

/** Mở luồng nếu chưa có + thêm bình luận: MỘT câu. RLS chặn luồng công ty khác / bài không thấy (42501). */
export async function insertComment(tx: Tx, c: NewComment): Promise<void> {
  // Hai câu (không CTE): policy `comments_insert` (0002) kiểm luồng bằng EXISTS — luồng vừa tạo trong cùng câu không thấy.
  const t = await tx.execute<{ id: string }>(sql`
    insert into community.threads (tenant_id, post_id, ext_org_id)
    values (${c.tenantId}::uuid, ${c.postId}::uuid, ${c.threadOrg}::uuid)
    on conflict (post_id, ext_org_id) do update set last_at = now()
    returning id::text as id`);
  await tx.execute(sql`
    insert into community.comments (tenant_id, post_id, thread_id, thread_org, author_user_id, author_name, author_org,
      text_raw, text_masked, hits)
    values (${c.tenantId}::uuid, ${c.postId}::uuid, ${t[0]?.id ?? null}::uuid, ${c.threadOrg}::uuid, ${c.userId}::uuid,
      ${c.authorName}, ${c.authorOrg}::uuid, ${c.text.raw}, ${c.text.masked}, ${JSON.stringify(c.text.hits)}::jsonb)`);
}

/** Review Thấp1: công ty `org` được có luồng trên bài? Bài đối tác ⇒ chỉ công ty đăng; bài chủ quản ⇒ trong audience (D2). */
export async function orgMaySee(tx: Tx, postId: string, org: string): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(sql`
    select case when p.author_org is not null then p.author_org = ${org}::uuid
      else community.audience_ok(p.aud_mode, p.aud_cats, p.aud_orgs, p.type, p.cats, ${org}::uuid,
        coalesce(pc.labels, '{}'), coalesce(pc.cats, '{}')) end as ok
    from community.posts p
    left join community.partner_companies pc on pc.tenant_id = p.tenant_id and pc.ext_org_id = ${org}::uuid
    where p.id = ${postId}::uuid`);
  return rows[0]?.ok === true;
}
