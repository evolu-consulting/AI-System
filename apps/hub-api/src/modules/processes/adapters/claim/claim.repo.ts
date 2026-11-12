// CR-127 · E2 · spec §5.1 · R#27 · repo "Nhận việc" trên `hub.review_tasks` (cột 0131: need/claimed_by/claimed_at/claim_deadline_at).
// Nhận = MỘT `UPDATE … WHERE status='open' AND claimed_by IS NULL RETURNING` (khoá hàng task, KHÔNG chạm run, không đổi cột FK
// ⇒ không lấy khoá run) — người thứ hai chờ hàng rồi thấy `claimed_by` đã đặt ⇒ 0 hàng ⇒ đọc lại tên người giữ. Thứ tự khoá
// run → task của cổng duyệt giữ nguyên: câu nhận không bao giờ chờ run nên không vào chu trình chờ (review-tasks.lock-order).
// Vòng tự trả theo khuôn `claimDueReminders`: task SKIP LOCKED → run FOR KEY SHARE SKIP LOCKED → chỉ ghi task có run giữ được.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ClaimReleaseBatch } from "../../application/ports";
import type { ClaimMiss } from "../../domain/tasks/claim.rules";

const iso = (d: Date): string => d.toISOString();
const uuids = (ids: Iterable<string>): string => `{${[...ids].join(",")}}`;
const nameOf = (col: string) =>
  sql.raw(`(select coalesce(nullif(u.display_name, ''), u.username) from admin.users u
    where u.id = ${col} and u.tenant_id = t.tenant_id)`);

export type ClaimHit = { claimedAt: Date; byName: string };

/**
 * CR-127 · FIX-OV · CR-113 · người Toàn quyền (Group "cũng quyết" `after.also_group_ids` của stage review trong snapshot run — bất biến)
 * Nhận việc được như thành viên nhóm; Duyệt sau đó ghi là duyệt thay (`overrideOnly`). Điều kiện con trong CÙNG câu (không thêm câu).
 */
const alsoMember = (g: string) => sql`(t.kind = 'review' and exists (select 1 from hub.stage_runs s
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    cross join lateral (select pr.snapshot->'stages'->(s.stage_idx::int)->'after'->'also_group_ids' as ag) x
    where s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      and jsonb_typeof(x.ag) = 'array' and x.ag ?| ${g}::text[]))`;

/**
 * SEC 2026-11-12 · N2-FR-05 · cùng nguồn `starterExcluded` (task-access.rules): task `review` của bước `after.kind='review'` bật
 * `exclude_starter` (snapshot run, bất biến) và `u` là `process_runs.started_by` ⇒ người gửi KHÔNG nhận được (kể cả qua Toàn quyền).
 */
const starterOut = (u: string) => sql`(t.kind = 'review' and exists (select 1 from hub.stage_runs s
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    cross join lateral (select pr.snapshot->'stages'->(s.stage_idx::int)->'after' as af) x
    where s.id = t.stage_run_id and s.tenant_id = t.tenant_id and pr.started_by = ${u}::uuid
      and x.af->>'kind' = 'review' and x.af->'exclude_starter' = 'true'::jsonb))`;

/**
 * MỘT câu: nhận task nhóm `need='one'` loại duyệt/mốc khi người xem thuộc Group assignee (hoặc Group chuyển cấp đã thêm, hoặc
 * Group Toàn quyền `also_group_ids` của stage — FIX-OV).
 * Hạn tự trả = lúc nhận + `tenant_flow_settings.claim_release_h` (vắng ⇒ 24). Không động `remind_at/created_at`.
 */
export async function claimTask(
  tx: Tx,
  a: { taskId: string; tenantId: string; userId: string; groupIds: Iterable<string>; now: Date },
): Promise<ClaimHit | null> {
  const g = uuids(a.groupIds);
  const [r] = await tx.execute<{ claimed_at: Date | string; by_name: string | null }>(sql`
    update hub.review_tasks t
    set claimed_by = ${a.userId}::uuid, claimed_at = ${iso(a.now)}::timestamptz,
      claim_deadline_at = ${iso(a.now)}::timestamptz + make_interval(hours => coalesce((select s.claim_release_h
        from hub.tenant_flow_settings s where s.tenant_id = t.tenant_id), 24))
    where t.id = ${a.taskId}::uuid and t.tenant_id = ${a.tenantId}::uuid and t.status = 'open' and t.claimed_by is null
      and t.need = 'one' and t.kind in ('review', 'milestone') and t.assignee_group_id is not null
      and (t.assignee_group_id = any(${g}::uuid[])
        or (t.escalated_at is not null and t.escalate_group_id = any(${g}::uuid[])) or ${alsoMember(g)})
      and not ${starterOut(a.userId)}
    returning t.claimed_at, ${nameOf("t.claimed_by")} as by_name`);
  return r ? { claimedAt: new Date(r.claimed_at), byName: r.by_name ?? a.userId } : null;
}

export type ClaimMissRow = ClaimMiss & { claimedAt: Date | null; byName: string | null };

/** Đọc lại khi nhận / trả / giao hụt (chỉ đường lỗi): trạng thái + người giữ + người xem có thuộc nhóm. */
export async function claimMiss(
  tx: Tx,
  a: { taskId: string; tenantId: string; groupIds: Iterable<string>; userId?: string },
): Promise<ClaimMissRow | null> {
  const g = uuids(a.groupIds);
  const [r] = await tx.execute<{
    status: "open" | "closed";
    kind: string;
    need: string;
    group_id: string | null;
    claimed_by: string | null;
    claimed_at: Date | string | null;
    by_name: string | null;
    member: boolean;
    starter_out: boolean;
  }>(sql`
    select t.status, t.kind, t.need, t.assignee_group_id as group_id, t.claimed_by, t.claimed_at,
      ${nameOf("t.claimed_by")} as by_name,
      (t.assignee_group_id = any(${g}::uuid[])
        or (t.escalated_at is not null and t.escalate_group_id = any(${g}::uuid[])) or ${alsoMember(g)}) as member,
      ${a.userId ? starterOut(a.userId) : sql`false`} as starter_out
    from hub.review_tasks t where t.id = ${a.taskId}::uuid and t.tenant_id = ${a.tenantId}::uuid`);
  if (!r) return null;
  return {
    status: r.status,
    kind: r.kind,
    need: r.need,
    groupId: r.group_id,
    claimedBy: r.claimed_by,
    claimedAt: r.claimed_at === null ? null : new Date(r.claimed_at),
    byName: r.by_name,
    member: r.member === true,
    starterExcluded: r.starter_out === true,
  };
}

/** MỘT câu: "Trả về nhóm" — chỉ người đang giữ, task còn mở. */
export async function releaseTask(
  tx: Tx,
  a: { taskId: string; tenantId: string; userId: string },
): Promise<boolean> {
  const rows = await tx.execute(sql`
    update hub.review_tasks t set claimed_by = null, claimed_at = null, claim_deadline_at = null
    where t.id = ${a.taskId}::uuid and t.tenant_id = ${a.tenantId}::uuid and t.status = 'open'
      and t.claimed_by = ${a.userId}::uuid
    returning t.id`);
  return rows.length > 0;
}

export type ReassignTarget = {
  status: "open" | "closed";
  kind: string;
  need: string;
  groupId: string | null;
  head: string | null;
  targetInGroup: boolean;
  /** CR-127 · E3b · cho thông báo người được giao. */
  processRunId: string;
  processName: string;
  stageName: string | null;
};

/** Đọc cho "Giao cho người khác": trạng thái task, trưởng phòng của nhóm, người nhận có trong nhóm (cùng tenant, còn hoạt động). */
export async function reassignTarget(
  tx: Tx,
  a: { taskId: string; tenantId: string; toUserId: string },
): Promise<ReassignTarget | null> {
  const [r] = await tx.execute<{
    status: "open" | "closed";
    kind: string;
    need: string;
    group_id: string | null;
    head: string | null;
    in_group: boolean;
    process_run_id: string;
    process_name: string | null;
    stage_name: string | null;
  }>(sql`
    select t.status, t.kind, t.need, t.assignee_group_id as group_id, t.process_run_id::text as process_run_id,
      (select pr.snapshot->>'name' from hub.process_runs pr where pr.id = t.process_run_id and pr.tenant_id = t.tenant_id)
        as process_name,
      (select pr.snapshot->'stages'->(s.stage_idx::int)->>'name' from hub.stage_runs s
        join hub.process_runs pr on pr.id = s.process_run_id and pr.tenant_id = s.tenant_id
        where s.id = t.stage_run_id and s.tenant_id = t.tenant_id) as stage_name,
      (select d.head_user_id from admin.departments d where d.group_id = t.assignee_group_id
        and d.tenant_id = t.tenant_id) as head,
      exists (select 1 from admin.group_members gm join admin.users u on u.id = gm.user_id and u.tenant_id = gm.tenant_id
        where gm.group_id = t.assignee_group_id and gm.tenant_id = t.tenant_id and gm.user_id = ${a.toUserId}::uuid
          and u.active and not u.locked_by_tenant) as in_group
    from hub.review_tasks t where t.id = ${a.taskId}::uuid and t.tenant_id = ${a.tenantId}::uuid`);
  if (!r) return null;
  return {
    status: r.status,
    kind: r.kind,
    need: r.need,
    groupId: r.group_id,
    head: r.head,
    targetInGroup: r.in_group === true,
    processRunId: r.process_run_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
  };
}

/** MỘT câu: đặt người giữ = người được giao (ghi đè người đang giữ), hạn tự trả tính lại từ `now`. */
export async function assignClaim(
  tx: Tx,
  a: { taskId: string; tenantId: string; toUserId: string; now: Date },
): Promise<ClaimHit | null> {
  const [r] = await tx.execute<{ claimed_at: Date | string; by_name: string | null }>(sql`
    update hub.review_tasks t
    set claimed_by = ${a.toUserId}::uuid, claimed_at = ${iso(a.now)}::timestamptz,
      claim_deadline_at = ${iso(a.now)}::timestamptz + make_interval(hours => coalesce((select s.claim_release_h
        from hub.tenant_flow_settings s where s.tenant_id = t.tenant_id), 24))
    where t.id = ${a.taskId}::uuid and t.tenant_id = ${a.tenantId}::uuid and t.status = 'open'
    returning t.claimed_at, ${nameOf("t.claimed_by")} as by_name`);
  return r ? { claimedAt: new Date(r.claimed_at), byName: r.by_name ?? a.toUserId } : null;
}

type ReleaseRow = {
  claimed: number | string;
  id: string | null;
  tenant_id: string;
  process_run_id: string;
  claimed_by: string;
  process_name: string | null;
  stage_name: string | null;
  head: string | null;
  admin_ids: string[] | null;
  more: boolean;
};

const releaseDue = (alias: string, now: Date) => sql`${sql.raw(alias)}.status = 'open'
  and ${sql.raw(alias)}.claimed_by is not null and ${sql.raw(alias)}.claim_deadline_at <= ${iso(now)}::timestamptz`;

/**
 * MỘT câu (vòng tự trả, scope system): khoá task đã nhận quá hạn (SKIP LOCKED, theo `review_tasks_claim_deadline_idx`), giữ run
 * FOR KEY SHARE SKIP LOCKED (FK notice → run không phải chờ cổng duyệt đang `lockRun`), trả task về nhóm (xoá `claimed_*`) và trả
 * người nhận báo: trưởng phòng của nhóm; không có ⇒ quản trị công ty (R#27). `claimed` = số task đã khoá (kể cả bị bỏ).
 */
export async function releaseDueClaims(
  tx: Tx,
  now: Date,
  limit: number,
): Promise<ClaimReleaseBatch> {
  const all = await tx.execute<ReleaseRow>(sql`
    with c0 as (
      select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, t.assignee_group_id, t.claimed_by
      from hub.review_tasks t
      where ${releaseDue("t", now)}
      order by t.claim_deadline_at asc, t.id asc
      limit ${limit}
      for update of t skip locked
    ), r as (
      select pr.id, pr.tenant_id from hub.process_runs pr
      where pr.id = any(array(select process_run_id from c0)) and pr.tenant_id = any(array(select tenant_id from c0))
      for key share skip locked
    ), c as (
      select c0.* from c0 join r on r.id = c0.process_run_id and r.tenant_id = c0.tenant_id
    ), u as (
      update hub.review_tasks t set claimed_by = null, claimed_at = null, claim_deadline_at = null
      from c where t.id = c.id and t.tenant_id = c.tenant_id
      returning t.id
    )
    select n.claimed, c.id, c.tenant_id, c.process_run_id, c.claimed_by,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name,
      hd.head,
      case when hd.head is null then array(select a.id::text from admin.users a
        where a.tenant_id = c.tenant_id and a.role = 'tenant_admin' and a.active and not a.locked_by_tenant
        order by a.id) end as admin_ids,
      exists (select 1 from hub.review_tasks t2
        where ${releaseDue("t2", now)} and not exists (select 1 from c where c.id = t2.id)) as more
    from (select count(*)::int as claimed from c0) n
    left join c on true
    left join hub.stage_runs s on s.id = c.stage_run_id and s.tenant_id = c.tenant_id
    left join hub.process_runs pr on pr.id = c.process_run_id and pr.tenant_id = c.tenant_id
    left join lateral (select d.head_user_id::text as head from admin.departments d
      where d.group_id = c.assignee_group_id and d.tenant_id = c.tenant_id) hd on true
    order by c.id`);
  const rows = all.filter((r): r is ReleaseRow & { id: string } => r.id !== null);
  return {
    tasks: rows.map((r) => ({
      taskId: r.id,
      tenantId: r.tenant_id,
      processRunId: r.process_run_id,
      claimedBy: r.claimed_by,
      processName: r.process_name ?? "",
      stageName: r.stage_name,
      head: r.head,
      tenantAdminIds: r.admin_ids ?? [],
    })),
    claimed: Number(all[0]?.claimed ?? 0),
    more: all[0]?.more === true,
  };
}
