// CR-102 · com-c3 · ghi bài: số câu cố định mỗi request (Luật 4c). Cột raw/masked/hits dựng sẵn ở lớp 1 (`content.rules`).
// RLS `community_rw` chặn đăng/sửa dưới tên bên khác; repo vẫn lọc `author_org` tường minh.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Audience, PostType } from "../domain/audience.rules";
import type { StoredContent } from "../domain/content.rules";

export type MediaIn = { kind: "image" | "video"; label: string; url?: string | undefined };

export type NewPost = {
  tenantId: string;
  userId: string;
  authorName: string;
  org: string | null;
  type: PostType;
  content: StoredContent;
  cats: readonly string[];
  /** Chỉ bài chủ quản (bài đối tác: null). */
  audience: Audience | null;
};

const hitsOf = (c: StoredContent) => JSON.stringify([...c.title.hits, ...c.body.hits]);

export async function insertPost(tx: Tx, p: NewPost): Promise<string> {
  const c = p.content;
  const rows = await tx.execute<{ id: string }>(sql`
    insert into community.posts (tenant_id, type, author_user_id, author_name, author_org, title_raw, title_masked,
      body_raw, body_masked, fields_raw, fields_masked, hits, cats, aud_mode, aud_cats, aud_orgs)
    values (${p.tenantId}::uuid, ${p.type}, ${p.userId}::uuid, ${p.authorName}, ${p.org}::uuid, ${c.title.raw},
      ${c.title.masked}, ${c.body.raw}, ${c.body.masked}, ${JSON.stringify(c.fields.raw)}::jsonb,
      ${JSON.stringify(c.fields.masked)}::jsonb, ${hitsOf(c)}::jsonb,
      array(select jsonb_array_elements_text(${JSON.stringify(p.cats)}::jsonb)),
      ${p.audience?.mode ?? null}, array(select jsonb_array_elements_text(${JSON.stringify(p.audience?.cats ?? [])}::jsonb)),
      array(select jsonb_array_elements_text(${JSON.stringify(p.audience?.companies ?? [])}::jsonb)::uuid))
    returning id::text as id`);
  return rows[0]?.id as string;
}

/** Thay mặt hàng (một mặt hàng từ `fields` raw) + media của bài: MỘT câu. */
export async function replaceChildren(
  tx: Tx,
  { tenantId, postId }: { tenantId: string; postId: string },
  fieldsRaw: Record<string, string | null>,
  media: readonly MediaIn[] | null,
): Promise<void> {
  const product = (fieldsRaw.product ?? "").trim();
  await tx.execute(sql`
    with d1 as (delete from community.post_items where post_id = ${postId}::uuid),
    d2 as (delete from community.media where post_id = ${postId}::uuid and ${media !== null}::boolean),
    i as (insert into community.post_items (tenant_id, post_id, position, product, qty, price)
      select ${tenantId}::uuid, ${postId}::uuid, 0, ${product}, ${fieldsRaw.qty ?? ""}, ${fieldsRaw.price ?? null}::text
      where ${product} <> ''),
    m as (insert into community.media (tenant_id, post_id, position, kind, label, url)
      select ${tenantId}::uuid, ${postId}::uuid, (x.n - 1)::smallint, x.e ->> 'kind', coalesce(x.e ->> 'label', ''),
        x.e ->> 'url'
      from jsonb_array_elements(${JSON.stringify(media ?? [])}::jsonb) with ordinality as x(e, n)
      where ${media !== null}::boolean)
    select 1`);
}

export type EditableRow = {
  type: PostType;
  author_org: string | null;
  fields_raw: Record<string, string | null>;
  title_raw: string;
  body_raw: string;
  author_user_id: string;
};

/** Bài của bên mình để sửa (khoá hàng). Bài bên khác / không thấy ⇒ null. */
export async function editable(
  tx: Tx,
  id: string,
  { org, userId }: { org: string | null; userId: string },
): Promise<EditableRow | null> {
  const rows = await tx.execute<EditableRow>(sql`
    select type, author_org, fields_raw, title_raw, body_raw, author_user_id::text as author_user_id
    from community.posts where id = ${id}::uuid and author_org is not distinct from ${org}::uuid
      and (author_org is null or author_user_id = ${userId}::uuid) for update`);
  return rows[0] ?? null;
}

export async function updatePost(
  tx: Tx,
  id: string,
  c: StoredContent,
  { cats, audience }: { cats: readonly string[] | null; audience: Audience | null },
): Promise<void> {
  await tx.execute(sql`
    update community.posts set title_raw = ${c.title.raw}, title_masked = ${c.title.masked}, body_raw = ${c.body.raw},
      body_masked = ${c.body.masked}, fields_raw = ${JSON.stringify(c.fields.raw)}::jsonb,
      fields_masked = ${JSON.stringify(c.fields.masked)}::jsonb, hits = ${hitsOf(c)}::jsonb,
      cats = case when ${cats !== null}::boolean
        then array(select jsonb_array_elements_text(${JSON.stringify(cats ?? [])}::jsonb)) else cats end,
      aud_mode = coalesce(${audience?.mode ?? null}, aud_mode),
      aud_cats = case when ${audience !== null}::boolean
        then array(select jsonb_array_elements_text(${JSON.stringify(audience?.cats ?? [])}::jsonb)) else aud_cats end,
      aud_orgs = case when ${audience !== null}::boolean
        then array(select jsonb_array_elements_text(${JSON.stringify(audience?.companies ?? [])}::jsonb)::uuid)
        else aud_orgs end,
      price_edited_at = case when (fields_raw ->> 'price') is distinct from (${JSON.stringify(c.fields.raw)}::jsonb ->> 'price')
        then now() else price_edited_at end,
      edited = true, edited_at = now(), updated_at = now()
    where id = ${id}::uuid`);
}

export type StateRow = {
  type: PostType;
  author_org: string | null;
  status: "active" | "archived" | "done";
  hidden: boolean;
  expires_at: string;
};

/** Trạng thái bài dưới RLS người xem (không thấy ⇒ null). */
export async function postState(tx: Tx, id: string): Promise<StateRow | null> {
  const rows = await tx.execute<StateRow>(sql`
    select type, author_org, status, hidden, expires_at from community.posts where id = ${id}::uuid`);
  return rows[0] ?? null;
}

export type StateAction = "archive" | "unarchive" | "done" | "delete" | "hide" | "unhide";

/** Áp một thao tác (đã kiểm `postActions`). Bỏ lưu trữ ⇒ gia hạn 30 ngày. Trả số hàng tác động. */
export async function applyAction(tx: Tx, id: string, a: StateAction): Promise<number> {
  if (a === "delete") {
    const r = await tx.execute(sql`delete from community.posts where id = ${id}::uuid`);
    return (r as unknown as { count: number }).count;
  }
  const r = await tx.execute(sql`
    update community.posts set
      status = case ${a}::text when 'archive' then 'archived' when 'unarchive' then 'active' when 'done' then 'done'
        else status end,
      expires_at = case when ${a}::text = 'unarchive' then now() + interval '30 days' else expires_at end,
      expiry_notified_at = case when ${a}::text = 'unarchive' then null else expiry_notified_at end,
      hidden = case ${a}::text when 'hide' then true when 'unhide' then false else hidden end,
      updated_at = now()
    where id = ${id}::uuid`);
  return (r as unknown as { count: number }).count;
}

/** HT-52: raw cho CHÍNH người đăng (không cả công ty). */
export async function ownSource(
  tx: Tx,
  id: string,
  userId: string,
): Promise<{ title: string; body: string; fields: Record<string, string | null> } | null> {
  const rows = await tx.execute<{
    title: string;
    body: string;
    fields: Record<string, string | null>;
  }>(sql`
    select title_raw as title, body_raw as body, fields_raw as fields from community.posts
    where id = ${id}::uuid and author_user_id = ${userId}::uuid`);
  return rows[0] ?? null;
}
