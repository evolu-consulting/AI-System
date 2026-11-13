// CR-145 · SQL nhắc người trong bài: MỘT câu mỗi việc, theo tập (không vòng lặp từng người).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PostType } from "../domain/audience.rules";
import type { Person } from "./people.reader";

const arr = (x: readonly string[]) => JSON.stringify([...x]);

/** Dạng nháp của bài chưa tạo: cùng tham số mà `community.audience_ok` nhận từ hàng `posts` (một luật, không viết song song — G1). */
export type DraftScope = {
  type: PostType;
  cats: readonly string[];
  audience: { mode: string; cats: readonly string[]; companies: readonly string[] };
};

/** Trong `orgs`, công ty nào sẽ thấy bài CHỦ QUẢN có phạm vi `d`. Một câu theo mảng. */
export async function orgsSeeingDraft(
  tx: Tx,
  d: DraftScope,
  orgs: readonly string[],
): Promise<string[]> {
  if (orgs.length === 0) return [];
  const rows = await tx.execute<{ org: string }>(sql`
    with o as (select jsonb_array_elements_text(${arr(orgs)}::jsonb)::uuid as id)
    select o.id::text as org
    from o left join contracts.community_partners(array(select id from o)) pc on pc.ext_org_id = o.id
    where community.audience_ok(${d.audience.mode}, array(select jsonb_array_elements_text(${arr(d.audience.cats)}::jsonb)),
      array(select jsonb_array_elements_text(${arr(d.audience.companies)}::jsonb)::uuid), ${d.type},
      array(select jsonb_array_elements_text(${arr(d.cats)}::jsonb)), o.id,
      coalesce(pc.roles, '{}'), coalesce(pc.cats, '{}'))`);
  return rows.map((r) => r.org);
}

/** Thay toàn bộ người được nhắc của bài bằng `people` (một câu: xoá người bỏ, thêm người mới). Trả id người MỚI (chưa từng được nhắc). */
export async function replaceMentions(
  tx: Tx,
  p: { tenantId: string; postId: string; by: string; people: readonly Person[] },
): Promise<string[]> {
  const want = JSON.stringify(p.people.map((x) => ({ id: x.id, name: x.name, org: x.org })));
  const rows = await tx.execute<{ user_id: string }>(sql`
    with want as (select (e ->> 'id')::uuid as id, e ->> 'name' as name, (e ->> 'org')::uuid as org
        from jsonb_array_elements(${want}::jsonb) e),
    del as (delete from community.post_mentions where post_id = ${p.postId}::uuid
        and user_id not in (select id from want)),
    ins as (insert into community.post_mentions (tenant_id, post_id, user_id, user_name, user_org, created_by)
        select ${p.tenantId}::uuid, ${p.postId}::uuid, w.id, w.name, w.org, ${p.by}::uuid from want w
        on conflict (post_id, user_id) do nothing returning user_id)
    select user_id::text as user_id from ins`);
  return rows.map((r) => r.user_id);
}

/** Người đang được nhắc của bài (cho chuông khi bài được duyệt). Chạy ở tx hệ thống (không app.user_id). */
export async function mentionedIds(tx: Tx, tenantId: string, postId: string): Promise<string[]> {
  const rows = await tx.execute<{ user_id: string }>(sql`
    select user_id::text as user_id from community.post_mentions
    where tenant_id = ${tenantId}::uuid and post_id = ${postId}::uuid order by created_at, user_id limit 50`);
  return rows.map((r) => r.user_id);
}
