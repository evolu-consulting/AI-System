// CR-102 · C6 · sửa / xoá / ẩn bình luận. Mỗi hàm MỘT câu; RLS lọc hàng (đối tác chỉ chạm bình luận của mình), 0 hàng ⇒ null.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StoredText } from "../domain/content.rules";

type Id = { postId: string; id: string };
const org = (rows: { thread_org: string }[]): string | null => rows[0]?.thread_org ?? null;

/** Sửa chữ của chính người viết. Trả luồng (thread_org) hoặc null. */
export async function editComment(
  tx: Tx,
  c: Id & { userId: string; text: StoredText },
): Promise<string | null> {
  return org(
    await tx.execute<{ thread_org: string }>(sql`
      update community.comments set text_raw = ${c.text.raw}, text_masked = ${c.text.masked},
        hits = ${JSON.stringify(c.text.hits)}::jsonb
      where id = ${c.id}::uuid and post_id = ${c.postId}::uuid and author_user_id = ${c.userId}::uuid
      returning thread_org`),
  );
}

/** Xoá bình luận của chính người viết. */
export async function deleteComment(tx: Tx, c: Id & { userId: string }): Promise<string | null> {
  return org(
    await tx.execute<{ thread_org: string }>(sql`
      delete from community.comments
      where id = ${c.id}::uuid and post_id = ${c.postId}::uuid and author_user_id = ${c.userId}::uuid
      returning thread_org`),
  );
}

/** Chủ quản ẩn/hiện bình luận bất kỳ trên bài CỦA MÌNH (author_org null). */
export async function hideComment(tx: Tx, c: Id & { hidden: boolean }): Promise<string | null> {
  return org(
    await tx.execute<{ thread_org: string }>(sql`
      update community.comments set hidden = ${c.hidden}::boolean
      where id = ${c.id}::uuid and post_id = ${c.postId}::uuid
        and exists (select 1 from community.posts p where p.id = ${c.postId}::uuid and p.author_org is null)
      returning thread_org`),
  );
}

/** "Nhắn riêng": luồng đã có, hoặc công ty là người đăng, hoặc công ty thuộc audience của bài (D2). */
export async function mayStartThread(tx: Tx, postId: string, orgId: string): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(sql`
    select exists (select 1 from community.threads t where t.post_id = ${postId}::uuid and t.ext_org_id = ${orgId}::uuid)
      or exists (select 1 from community.posts p
        left join community.partner_companies pc on pc.ext_org_id = ${orgId}::uuid and pc.tenant_id = p.tenant_id
        where p.id = ${postId}::uuid and (p.author_org = ${orgId}::uuid
          or (pc.ext_org_id is not null and community.audience_ok(p.aud_mode, p.aud_cats, p.aud_orgs, p.type, p.cats,
            pc.ext_org_id, pc.labels, pc.cats)))) as ok`);
  return rows[0]?.ok === true;
}
