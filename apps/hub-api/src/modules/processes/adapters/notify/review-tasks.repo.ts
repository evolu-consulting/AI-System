// HUB-FR-112 · HUB-FR-145 · CR-093 · plan-addendum A10/A11 · PD-R18…R20 · K3 lô · repo lô `review_tasks` cho vòng nhắc +
// chuyển cấp (chỉ `systemBatch`). Mỗi hàm = MỘT câu SQL văn bản cố định; dữ liệu lô qua MỘT tham số JSON
// (`jsonb_to_recordset`) — không `unnest`-join bảng lớn, không lặp theo hàng. Khoá `FOR UPDATE SKIP LOCKED` theo
// `(id, tenant_id)`; mọi join/insert khớp `tenant_id` của hàng nguồn. Chỉ làm việc DB; người gọi phát sự kiện SAU COMMIT.
// Review T12 #1 (khoá đồng thời với cổng duyệt `lockRun` FOR UPDATE → `closeTask`): câu claim khoá task (`c0`, SKIP LOCKED)
// rồi run cha (`r`: `id = any(array(…))` theo PK, khớp `tenant_id`, FOR KEY SHARE SKIP LOCKED) và CHỈ trả/ghi task có run
// giữ được; task có run đang bị tx khác giữ bị bỏ (khoá task nhả lúc COMMIT, lô sau nhận). Không deadlock: lô không bao giờ
// CHỜ khoá nào — task và run đều SKIP LOCKED, các câu sau (FK `process_notices` → run, FK assignee → task) chỉ chạm hàng
// đã giữ ⇒ lô không thể nằm trong chu trình chờ; người duyệt chờ task tối đa một lô. `claimed` = số task đã khoá (kể cả bị
// bỏ) để điều kiện "lô đầy" không dừng xả sớm. Không join run trước `limit` (join theo thống kê cũ chạy cho MỌI hàng tới hạn
// ⇒ PD-P13 10.000 task 4,2 s → 5,6–10,7 s).
// Dời nguyên từ `notify/batch.repo.ts` (T9) + thêm nhắc lặp / chuyển cấp.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ClaimedReminder, ReminderBatch, ReminderMark } from "../../application/ports";
import { headGateSql } from "../../core/head-gate.sql";
import {
  addEscalatedGroups,
  auditEscalations,
  claimDueEscalations,
} from "./review-escalations.repo";

// Chuyển cấp ở `review-escalations.repo.ts` (PD-A03); xuất lại để người dùng cũ (`hub-uow`, test khoá-thứ-tự) giữ nguyên.
export { addEscalatedGroups, auditEscalations, claimDueEscalations };

const iso = (d: Date): string => d.toISOString();
const date = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

/** Điều kiện tới hạn nhắc — khớp vị từ index `review_tasks_remind_due_idx` (0036) + `dueReminder` (lớp 1). */
const remindDue = (alias: string, now: Date) => sql`${sql.raw(alias)}.status = 'open'
  and (${sql.raw(alias)}.reminded_at is null
    or (${sql.raw(alias)}.remind_every_h is not null and ${sql.raw(alias)}.remind_count < 10))
  and ${sql.raw(alias)}.remind_at <= ${iso(now)}::timestamptz`;

type ReminderRow = {
  claimed: number | string;
  id: string | null;
  tenant_id: string;
  process_run_id: string;
  group_id: string | null;
  remind_at: Date | string;
  reminded_at: Date | string | null;
  remind_every_h: number | null;
  remind_count: number;
  process_name: string | null;
  stage_name: string | null;
  user_ids: string[] | null;
  member_ids: string[] | null;
  more: boolean;
};

/**
 * MỘT câu: khoá task mở tới hạn nhắc (cũ: chưa nhắc; lặp: `remind_count < 10`), bỏ qua hàng Hub khác đang khoá (#190),
 * trả kèm tên quy trình/bước + người nhận = user assignee ∪ thành viên MỌI Group assignee (gồm Group chuyển cấp, PD-R21).
 * Group chuyển cấp lấy từ chính hàng task (`escalated_at` đặt ⇒ `escalate_group_id`; Group bị bỏ qua vì khác tenant/đã xoá ⇒ 0
 * thành viên do lọc `gm.tenant_id`) — không quét `review_task_assignees` theo Group (không có index `task_id` cho hàng
 * Group). Người nhận qua subquery tương quan theo index (`= any(array)`), khớp `tenant_id` task nguồn (K3 lô). Không ghi —
 * `markRemindedMany` áp mốc kế do lớp 1 tính.
 */
/** contract-flow S1b · stage `head_only` + phòng có trưởng ⇒ phía Group duyệt chỉ nhắc trưởng phòng (Group chuyển cấp giữ). */
const REMIND_GATE = headGateSql("pr.snapshot->'stages'->(s.stage_idx::int)", "c.tenant_id");

export async function claimDueReminders(tx: Tx, now: Date, limit: number): Promise<ReminderBatch> {
  const q = sql`
    with c0 as (
      select t.id, t.tenant_id, t.process_run_id, t.stage_run_id, t.assignee_group_id, t.remind_at, t.reminded_at,
        t.remind_every_h, t.remind_count, t.escalate_group_id, t.escalated_at, t.kind
      from hub.review_tasks t
      where ${remindDue("t", now)}
      order by t.remind_at asc, t.id asc
      limit ${limit}
      for update of t skip locked
    ), r as (
      select pr.id, pr.tenant_id from hub.process_runs pr
      where pr.id = any(array(select process_run_id from c0)) and pr.tenant_id = any(array(select tenant_id from c0))
      for key share skip locked
    ), c as (
      select c0.* from c0 join r on r.id = c0.process_run_id and r.tenant_id = c0.tenant_id
    )
    select n.claimed, c.id, c.tenant_id, c.process_run_id, c.assignee_group_id as group_id, c.remind_at, c.reminded_at,
      c.remind_every_h::int as remind_every_h, c.remind_count::int as remind_count,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name,
      array(select a.user_id::text from hub.review_task_assignees a
        where a.task_id = c.id and a.tenant_id = c.tenant_id and a.user_id is not null) as user_ids,
      array(select gm.user_id::text from admin.group_members gm
        where gm.tenant_id = c.tenant_id and gm.group_id = any(array[
          case when hg.gate is null then c.assignee_group_id end,
          case when c.escalated_at is not null then c.escalate_group_id end]))
        || case when hg.gate is not null then array[hg.gate::text] else '{}'::text[] end as member_ids,
      exists (select 1 from hub.review_tasks t2
        where ${remindDue("t2", now)} and not exists (select 1 from c where c.id = t2.id)) as more
    from (select count(*)::int as claimed from c0) n
    left join c on true
    left join hub.stage_runs s on s.id = c.stage_run_id and s.tenant_id = c.tenant_id
    left join hub.process_runs pr on pr.id = c.process_run_id and pr.tenant_id = c.tenant_id
    left join lateral (select case when c.kind = 'review' then ${REMIND_GATE} end as gate) hg on true
    order by c.remind_at asc, c.id asc`;
  const all = await tx.execute<ReminderRow>(q);
  // Luôn ≥ 1 hàng (`claimed`); hàng `id` null = không còn task nào sau khi bỏ task có run đang bị giữ.
  const rows = all.filter((r): r is ReminderRow & { id: string } => r.id !== null);
  return {
    tasks: rows.map(toReminder),
    claimed: Number(all[0]?.claimed ?? 0),
    more: all[0]?.more === true,
  };
}

function toReminder(r: ReminderRow & { id: string }): ClaimedReminder {
  return {
    taskId: r.id,
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    groupId: r.group_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
    userIds: r.user_ids ?? [],
    groupMemberIds: r.member_ids ?? [],
    remindAt: new Date(r.remind_at),
    remindedAt: date(r.reminded_at),
    remindEveryH: r.remind_every_h === null ? null : Number(r.remind_every_h),
    remindCount: Number(r.remind_count),
  };
}

/**
 * MỘT câu: áp mốc nhắc kế (lớp 1 `nextRemind`) cho cả lô — `update … from jsonb_to_recordset` theo `(id, tenant_id)`
 * (PK, không phụ thuộc thống kê); `reminded_at = now` (cũ: đúng 1 lần — HUB-BR-26). Guard `status = 'open'`.
 */
export async function markRemindedMany(
  tx: Tx,
  now: Date,
  rows: readonly ReminderMark[],
): Promise<void> {
  const json = JSON.stringify(
    rows.map((r) => ({
      id: r.taskId,
      tenant_id: r.tenantId,
      remind_at: iso(r.remindAt),
      remind_count: r.remindCount,
    })),
  );
  // JSON gom thành MỘT hàng mảng ⇒ nested loop 1 hàng ngoài + `id = any(ids)` tra PK (không hash/seq scan theo thống
  // kê cũ sau chèn hàng loạt); giá trị mỗi hàng lấy theo vị trí, `tenant_id` phải khớp hàng nguồn (K3 lô).
  await tx.execute(sql`
    with x as (
      select array_agg(r.id) as ids, array_agg(r.tenant_id) as tids, array_agg(r.remind_at) as ats,
        array_agg(r.remind_count) as cnts
      from jsonb_to_recordset(${json}::jsonb) as r(id uuid, tenant_id uuid, remind_at timestamptz, remind_count int)
    )
    update hub.review_tasks t
    set reminded_at = ${iso(now)}::timestamptz,
      remind_at = x.ats[array_position(x.ids, t.id)],
      remind_count = x.cnts[array_position(x.ids, t.id)]
    from x
    where t.id = any(x.ids) and t.tenant_id = x.tids[array_position(x.ids, t.id)] and t.status = 'open'`);
}

/** Làm nóng: chạy đủ văn bản câu của vòng nhắc + chuyển cấp với lô rỗng (không ghi hàng nào). */
export async function warmReviewTasks(tx: Tx): Promise<void> {
  const epoch = new Date(0);
  await claimDueReminders(tx, epoch, 0);
  await markRemindedMany(tx, epoch, []);
  await claimDueEscalations(tx, epoch, 0);
  await addEscalatedGroups(tx, []);
  await auditEscalations(tx, []);
}
