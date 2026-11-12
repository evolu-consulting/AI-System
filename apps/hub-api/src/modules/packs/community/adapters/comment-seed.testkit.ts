// CR-129 · dựng bình luận phẳng bằng owner (bỏ RLS) cho int: thay `seedComments` cũ của `tests/acceptance/com-c3/_support/cast.ts`
// (file khoá, còn dựa vào bảng `threads` đã gỡ — qc sẽ sửa). Một câu theo tập.
import type { Sql } from "@ai/test-kit/db";

export type CommentSeed = {
  key: string;
  post: string;
  author: string;
  /** null = chủ quản. */
  org: string | null;
  hidden?: boolean;
  /** Công ty được nhắc (`mention_orgs`). */
  mentions?: readonly string[];
};

/** Trả `key -> id` (key lưu ở `text_raw`/`text_masked`). */
export async function seedComments(
  sql: Sql,
  tenant: string,
  rows: readonly CommentSeed[],
): Promise<Map<string, string>> {
  const data = sql.json(
    rows.map((r) => ({ ...r, hidden: r.hidden ?? false, mentions: r.mentions ?? [] })),
  );
  const got = await sql<{ key: string; id: string }[]>`
    insert into community.comments (tenant_id, post_id, author_user_id, author_name, author_org, text_raw, text_masked,
      hidden, mention_orgs)
    select ${tenant}::uuid, x.post, x.author, 'Người viết', x.org, x.key, x.key, x.hidden,
      array(select jsonb_array_elements_text(x.mentions)::uuid)
    from jsonb_to_recordset(${data}) as x(key text, post uuid, author uuid, org uuid, hidden boolean, mentions jsonb)
    returning text_raw as key, id::text as id`;
  return new Map(got.map((r) => [r.key, r.id]));
}
