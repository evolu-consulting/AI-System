// CR-102b · C7b · SQL "Lưu báo giá" phía community (bảng `quote_saves`, chỉ chủ quản qua RLS). Mỗi hàm MỘT câu.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type QuoteSource = {
  type: "sell" | "buy" | "note";
  author_org: string | null;
  /** NCC = công ty đăng bài (lưu từ bài) hoặc công ty của luồng (lưu từ bình luận). */
  supplier_org: string | null;
  party_key: string | null;
  /** null khi lưu từ bài; có khi bình luận tồn tại trong bài. */
  comment: { author_org: string | null } | null;
  comment_missing: boolean;
};

/** Bài (+ bình luận nếu có) + liên kết đối tác SHT của NCC, dưới RLS chủ quản. Bài không thấy ⇒ null. */
export async function quoteSource(
  tx: Tx,
  postId: string,
  commentId: string | null,
): Promise<QuoteSource | null> {
  const rows = await tx.execute<QuoteSource>(sql`
    select p.type, p.author_org::text as author_org,
      coalesce(c.thread_org, p.author_org)::text as supplier_org,
      (select pc.party_key from community.partner_companies pc
        where pc.tenant_id = p.tenant_id and pc.ext_org_id = coalesce(c.thread_org, p.author_org)) as party_key,
      case when c.id is null then null else json_build_object('author_org', c.author_org) end as comment,
      (${commentId}::uuid is not null and c.id is null) as comment_missing
    from community.posts p
    left join community.comments c on c.id = ${commentId}::uuid and c.post_id = p.id
    where p.id = ${postId}::uuid`);
  return rows[0] ?? null;
}

export type SavedRow = { by: string; at: string };

export async function existingSave(
  tx: Tx,
  postId: string,
  itemIdx: number,
  commentId: string | null,
): Promise<SavedRow | null> {
  const rows = await tx.execute<SavedRow>(sql`
    select saved_by_name as by, saved_at as at from community.quote_saves
    where post_id = ${postId}::uuid and item_idx = ${itemIdx}::smallint
      and comment_id is not distinct from ${commentId}::uuid`);
  return rows[0] ?? null;
}

export type NewSave = {
  tenantId: string;
  postId: string;
  commentId: string | null;
  itemIdx: number;
  userId: string;
  userName: string;
  priceId: string;
  productId: string;
  supplier: string;
  price: number;
  unit: string | null;
  notify: boolean;
};

/** Lưu đè (R28): chèn hoặc thay theo (bài, mặt hàng, bình luận); trả lần lưu TRƯỚC (người khác/trước đó) trong cùng câu. */
export async function upsertSave(tx: Tx, s: NewSave): Promise<SavedRow | null> {
  const rows = await tx.execute<{ prev: SavedRow | null }>(sql`
    with prev as (
      select saved_by_name as by, saved_at as at from community.quote_saves
      where post_id = ${s.postId}::uuid and item_idx = ${s.itemIdx}::smallint
        and comment_id is not distinct from ${s.commentId}::uuid),
    up as (
      insert into community.quote_saves (tenant_id, post_id, comment_id, item_idx, saved_by, saved_by_name, price_id,
        product_id, supplier_name, price, unit, notify_price_edit)
      values (${s.tenantId}::uuid, ${s.postId}::uuid, ${s.commentId}::uuid, ${s.itemIdx}::smallint, ${s.userId}::uuid,
        ${s.userName}, ${s.priceId}::uuid, ${s.productId}::uuid, ${s.supplier}, ${s.price}::bigint, ${s.unit}, ${s.notify})
      on conflict (post_id, item_idx, (coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      do update set saved_by = excluded.saved_by, saved_by_name = excluded.saved_by_name, saved_at = now(),
        price_id = excluded.price_id, product_id = excluded.product_id, supplier_name = excluded.supplier_name,
        price = excluded.price, unit = excluded.unit, notify_price_edit = excluded.notify_price_edit
      returning 1)
    select (select json_build_object('by', by, 'at', at) from prev) as prev from up`);
  return rows[0]?.prev ?? null;
}

/** Người đã lưu báo giá của bài và muốn được báo khi NCC sửa giá (R27; nguồn cho thông báo C9 `priceEdited`). */
export async function savedUsers(tx: Tx, tenantId: string, postId: string): Promise<string[]> {
  const rows = await tx.execute<{ u: string }>(sql`
    select distinct saved_by::text as u from community.quote_saves
    where tenant_id = ${tenantId}::uuid and post_id = ${postId}::uuid and notify_price_edit`);
  return rows.map((r) => r.u);
}
