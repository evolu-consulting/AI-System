// CR-102 · com-c9 · SQL của chuông Community: mỗi hàm MỘT câu (Luật 4c), văn bản cố định, lô qua một tham số jsonb.
// Visibility của người nhận dùng đúng `community.audience_ok` + điều kiện `posts_visible` của RLS (0001), công ty đã rời bị loại.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { BellKind, Cand, CommentCand } from "../domain/notify.rules";

const arr = (xs: readonly string[]) => JSON.stringify(xs);

/** Ứng viên nhận bình luận (người đăng + người từng bình luận trong luồng, trừ `actor`) + tiêu đề đã che của bài. */
export async function commentCandidates(
  tx: Tx,
  q: {
    tenantId: string;
    postId: string;
    threadOrg: string;
    actorUserId: string;
    at: Date;
    inactiveOrgs: readonly string[];
  },
): Promise<{ title: string; cands: CommentCand[] }> {
  const rows = await tx.execute<{
    u: string;
    o: string | null;
    role: "author" | "commenter";
    title: string;
    sees: boolean;
  }>(sql`
    with p as (select id, type, author_user_id, author_org, title_masked, status, hidden, expires_at, aud_mode, aud_cats,
        aud_orgs, cats from community.posts where id = ${q.postId}::uuid and tenant_id = ${q.tenantId}::uuid),
      cand as (
        select p.author_user_id as u, p.author_org as o, 'author' as role from p
        union
        select c.author_user_id, c.author_org, 'commenter' from community.comments c
          where c.post_id = ${q.postId}::uuid and c.tenant_id = ${q.tenantId}::uuid
            and c.thread_org = ${q.threadOrg}::uuid and not c.hidden)
    select cand.u::text as u, cand.o::text as o, cand.role, p.title_masked as title,
      (cand.o is null or (cand.o::text <> all (array(select jsonb_array_elements_text(${arr(q.inactiveOrgs)}::jsonb)))
        and (p.author_org = cand.o or (p.author_org is null and p.status = 'active' and not p.hidden
          and p.expires_at > ${q.at.toISOString()}::timestamptz
          and community.audience_ok(p.aud_mode, p.aud_cats, p.aud_orgs, p.type, p.cats, cand.o,
            coalesce(pc.labels, '{}'), coalesce(pc.cats, '{}')))))) as sees
    from cand cross join p
    left join community.partner_companies pc on pc.tenant_id = ${q.tenantId}::uuid and pc.ext_org_id = cand.o
    where cand.u <> ${q.actorUserId}::uuid`);
  return {
    title: rows[0]?.title ?? "",
    cands: rows.map((r) => ({ userId: r.u, org: r.o, role: r.role, sees: r.sees })),
  };
}

/** Tuỳ chọn: giữ cặp (người, loại) mà người đó muốn nhận (hàm DEFINER 0003 — đọc được hàng của người khác). */
export async function wantedOnly(tx: Tx, items: readonly Cand[]): Promise<Cand[]> {
  if (items.length === 0) return [];
  const rows = await tx.execute<{ user_id: string; kind: BellKind }>(
    sql`select user_id::text as user_id, kind from community.notify_wanted(${JSON.stringify(
      items.map((i) => ({ user_id: i.userId, kind: i.kind })),
    )}::jsonb)`,
  );
  return rows.map((r) => ({ userId: r.user_id, kind: r.kind }));
}

export type SweptPost = { id: string; author: string; title: string; expires_at: string };

/**
 * Vòng nền, MỘT câu mỗi pha (CTE, `FOR UPDATE SKIP LOCKED`, lô ≤ `limit`, mốc giờ = tham số `at`):
 * pha 1 tự lưu trữ bài `active` quá hạn; pha 2 đánh dấu + trả bài còn ≤ 3 ngày chưa nhắc.
 */
export async function archiveExpired(tx: Tx, t: string, at: Date, limit: number): Promise<number> {
  const rows = await tx.execute<{ id: string }>(sql`
    with o as (select id from community.posts where tenant_id = ${t}::uuid and status = 'active'
        and expires_at <= ${at.toISOString()}::timestamptz order by expires_at, id limit ${limit}::int
        for update skip locked)
    update community.posts x set status = 'archived', updated_at = now()
    from o where x.id = o.id and x.tenant_id = ${t}::uuid returning x.id`);
  return rows.length;
}

export async function markExpiring(
  tx: Tx,
  t: string,
  at: Date,
  limit: number,
): Promise<SweptPost[]> {
  return tx.execute<SweptPost>(sql`
    with o as (select id from community.posts where tenant_id = ${t}::uuid and status = 'active'
        and expiry_notified_at is null and expires_at > ${at.toISOString()}::timestamptz
        and expires_at <= ${at.toISOString()}::timestamptz + interval '3 days'
        order by expires_at, id limit ${limit}::int for update skip locked)
    update community.posts x set expiry_notified_at = ${at.toISOString()}::timestamptz
    from o where x.id = o.id and x.tenant_id = ${t}::uuid
    returning x.id::text as id, x.author_user_id::text as author, x.title_masked as title, x.expires_at`);
}

/**
 * Tổng hợp hằng ngày (COULD): người đã BẬT `digest` chưa gửi trong ngày `day` ⇒ đánh dấu + trả số bài đối tác mới trong 24 giờ
 * và số bài Cần bán đang mở. Chỉ user nội bộ; chạy ở tx hệ thống (RLS thấy mọi hàng settings của tenant).
 */
export async function claimDigest(
  tx: Tx,
  t: string,
  day: string,
  at: Date,
  hosts: readonly string[],
): Promise<{ users: string[]; fresh: number; openSell: number }> {
  const rows = await tx.execute<{ users: string[] | null; fresh: number; open_sell: number }>(sql`
    with s as (select user_id from community.settings where tenant_id = ${t}::uuid
        and notify -> 'digest' = 'true'::jsonb and (digest_on is null or digest_on < ${day}::date)
        and user_id = any(array(select jsonb_array_elements_text(${arr(hosts)}::jsonb))::uuid[])
        order by user_id limit 500 for update skip locked),
      u as (update community.settings x set digest_on = ${day}::date from s
        where x.tenant_id = ${t}::uuid and x.user_id = s.user_id returning x.user_id)
    select (select array_agg(user_id::text) from u) as users,
      (select count(*)::int from community.posts where tenant_id = ${t}::uuid and author_org is not null
        and created_at > ${at.toISOString()}::timestamptz - interval '24 hours') as fresh,
      (select count(*)::int from community.posts where tenant_id = ${t}::uuid and author_org is not null
        and type = 'sell' and status = 'active' and not hidden and expires_at > ${at.toISOString()}::timestamptz) as open_sell`);
  const r = rows[0];
  return {
    users: r?.users ?? [],
    fresh: Number(r?.fresh ?? 0),
    openSell: Number(r?.open_sell ?? 0),
  };
}
