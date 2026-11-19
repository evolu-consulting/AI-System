// CR-145 · SQL nhắc người trong bài: MỘT câu mỗi việc, theo tập (không vòng lặp từng người).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Person } from "../../kit/public";
import type { PostType } from "../domain/audience.rules";

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
  const want = JSON.stringify(
    p.people.map((x) => ({
      id: x.id,
      name: x.name,
      org: x.org,
      tenant: x.tenant && x.tenant !== p.tenantId ? x.tenant : null,
    })),
  );
  const rows = await tx.execute<{ user_id: string }>(sql`
    with want as (select (e ->> 'id')::uuid as id, e ->> 'name' as name, (e ->> 'org')::uuid as org, (e ->> 'tenant')::uuid as tenant
        from jsonb_array_elements(${want}::jsonb) e),
    del as (delete from community.post_mentions where post_id = ${p.postId}::uuid
        and user_id not in (select id from want)),
    ins as (insert into community.post_mentions (tenant_id, post_id, user_id, user_name, user_org, user_tenant, created_by)
        select ${p.tenantId}::uuid, ${p.postId}::uuid, w.id, w.name, w.org, w.tenant, ${p.by}::uuid from want w
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

/**
 * CR-186 · lọc nhóm «Nhắc tên»: trong `orgs`, công ty nào thuộc nhóm. `customer` = có vai khách hàng (người mua); `partner` = có vai
 * nhà cung cấp hoặc chưa có vai nào (không gồm công ty chỉ là khách hàng). Công ty vừa NCC vừa mua nằm ở cả hai nhóm. Một câu theo mảng,
 * cùng nguồn vai với `orgsSeeingDraft` (`contracts.community_partners`) ⇒ không mở thêm quyền xem.
 */
export async function orgsInGroup(
  tx: Tx,
  orgs: readonly string[],
  group: "partner" | "customer",
): Promise<string[]> {
  if (orgs.length === 0) return [];
  const rows = await tx.execute<{ org: string }>(sql`
    with o as (select jsonb_array_elements_text(${arr(orgs)}::jsonb)::uuid as id)
    select o.id::text as org
    from o left join contracts.community_partners(array(select id from o)) pc on pc.ext_org_id = o.id
    where case when ${group}::text = 'customer' then 'customer' = any(coalesce(pc.roles, '{}'::text[]))
      else 'supplier' = any(coalesce(pc.roles, '{}'::text[])) or not 'customer' = any(coalesce(pc.roles, '{}'::text[])) end`);
  return rows.map((r) => r.org);
}

/** CR-191 · người được nhắc kèm tenant của họ (null = cùng tenant/đối tác): để chuông tới đúng tenant của người nhận. `ids` vắng ⇒ mọi người được nhắc. */
export async function mentionTargets(
  tx: Tx,
  tenantId: string,
  postId: string,
  ids?: readonly string[],
): Promise<{ id: string; tenant: string | null }[]> {
  const rows = await tx.execute<{ user_id: string; user_tenant: string | null }>(sql`
    select user_id::text as user_id, user_tenant::text as user_tenant from community.post_mentions
    where tenant_id = ${tenantId}::uuid and post_id = ${postId}::uuid
      and (${ids === undefined}::boolean or user_id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids ?? [])}::jsonb))::uuid[]))
    order by created_at, user_id limit 50`);
  return rows.map((x) => ({ id: x.user_id, tenant: x.user_tenant }));
}

/** CR-191 · mọi công ty đã kết nối + công ty đó có thấy bài với «Ai thấy bài» này không (DEFINER `community.connected_audience`). */
export async function connectedAudience(
  tx: Tx,
  mode: string,
  tenants: readonly string[],
): Promise<{ tenantId: string; name: string; sees: boolean }[]> {
  const rows = await tx.execute<{ tenant_id: string; company_name: string; sees: boolean }>(sql`
    select tenant_id::text as tenant_id, company_name, sees
    from community.connected_audience(${mode}::text, array(select jsonb_array_elements_text(${arr(tenants)}::jsonb))::uuid[])`);
  return rows.map((x) => ({ tenantId: x.tenant_id, name: x.company_name, sees: x.sees }));
}

/** Tenant đã kết nối sẽ thấy bài NHÁP có «Ai thấy bài» `mode`/`tenants`. */
export async function connectedSeeingDraft(
  tx: Tx,
  mode: string,
  tenants: readonly string[],
): Promise<string[]> {
  return (await connectedAudience(tx, mode, tenants)).filter((x) => x.sees).map((x) => x.tenantId);
}

/** Tenant đã kết nối thấy bài ĐÃ CÓ (theo `aud_mode`/`aud_tenants` của hàng). */
export async function connectedSeeingPost(tx: Tx, postId: string): Promise<string[]> {
  const rows = await tx.execute<{ t: string }>(sql`
    select t::text as t from community.mention_tenants_ok(${postId}::uuid,
      array(select tenant_id from community.connected_audience('all', '{}'::uuid[]))) t`);
  return rows.map((x) => x.t);
}

/** Trong `tenants`, công ty nào được nhắc người trên bài này (DEFINER). */
export async function mentionTenantsOk(
  tx: Tx,
  postId: string,
  tenants: readonly string[],
): Promise<string[]> {
  const rows = await tx.execute<{ t: string }>(sql`
    select t::text as t from community.mention_tenants_ok(${postId}::uuid,
      array(select jsonb_array_elements_text(${arr(tenants)}::jsonb))::uuid[]) t`);
  return rows.map((x) => x.t);
}

/** Soát #2 · như `mentionTenantsOk` nhưng cho tx HỆ THỐNG (chuông chạy nền, kiểm lại kết nối + «Ai thấy bài» NGAY lúc gửi). */
export async function mentionTenantsLive(
  tx: Tx,
  postId: string,
  tenants: readonly string[],
): Promise<string[]> {
  if (tenants.length === 0) return [];
  const rows = await tx.execute<{ t: string }>(sql`
    select t::text as t from community.mention_tenants_live(${postId}::uuid,
      array(select jsonb_array_elements_text(${arr(tenants)}::jsonb))::uuid[]) t`);
  return rows.map((x) => x.t);
}

/** Soát #1 · sửa bài thu hẹp «Ai thấy bài» mà không gửi lại danh sách nhắc ⇒ xoá người công ty kết nối không còn đạt (MỘT câu, trong tx sửa bài). */
export async function pruneForeignMentions(
  tx: Tx,
  postId: string,
  narrowed: boolean,
): Promise<number> {
  if (!narrowed) return 0;
  const rows = await tx.execute<{ user_id: string }>(sql`
    with ok as (select t from community.mention_tenants_ok(${postId}::uuid,
      array(select distinct user_tenant from community.post_mentions where post_id = ${postId}::uuid and user_tenant is not null)) t)
    delete from community.post_mentions m
     where m.post_id = ${postId}::uuid and m.user_tenant is not null
       and m.user_tenant not in (select t from ok)
    returning m.user_id::text as user_id`);
  return rows.length;
}
