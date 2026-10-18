// HUB-FR-112 · HUB-FR-115 · CR-093 · plan-addendum A10/A11 · TECH-DEBT #190 · truy vấn THEO TẬP cho vòng nền (nhắc, hết
// hạn): mỗi lô vài câu SQL cố định, không phụ thuộc số hàng. Scope `system` (một tx mỗi lô, nhiều tenant): mọi join/insert
// khớp `tenant_id` của hàng nguồn (K3 bản lô, A11); khoá `FOR UPDATE SKIP LOCKED` ⇒ nhiều Hub chạy song song không xử lý
// trùng hàng. Chỉ làm việc DB; người gọi phát sự kiện SAU COMMIT.
import type { NoticeKind } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { InsertedNotice } from "./inbox.repo";

const iso = (d: Date): string => d.toISOString();

export type TaskRecipients = { userIds: string[]; groupMemberIds: string[] };
export type ClaimedReminder = TaskRecipients & {
  taskId: string;
  tenantId: string;
  processRunId: string;
  groupId: string | null;
  processName: string;
  stageName: string | null;
};
/** Lô task vừa nhận + cờ `more` (còn task tới hạn ngoài lô ⇒ lượt xả chạy tiếp; tránh một tx rỗng để biết đã hết). */
export type ReminderBatch = { tasks: ClaimedReminder[]; more: boolean };

/**
 * MỘT câu: khoá task mở tới hạn chưa nhắc (cũ trước, bỏ qua hàng Hub khác đang khoá — #190), đặt `reminded_at` (đúng 1
 * lần — HUB-BR-26), trả kèm tên quy trình/bước và người nhận (user assignee, thành viên group hiện tại). Người nhận lấy
 * bằng subquery tương quan theo PK/index (`review_task_assignees_user_uq`, `group_members_pkey`) — 100 lần tra index,
 * không join theo thống kê; mọi điều kiện khớp `tenant_id` của task nguồn (K3 lô, A11).
 */
export async function claimDueReminders(tx: Tx, now: Date, limit: number): Promise<ReminderBatch> {
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    process_run_id: string;
    group_id: string | null;
    process_name: string | null;
    stage_name: string | null;
    user_ids: string[] | null;
    member_ids: string[] | null;
    more: boolean;
  }>(sql`
    with c as (
      select t.id, t.tenant_id from hub.review_tasks t
      where t.status = 'open' and t.reminded_at is null and t.remind_at <= ${iso(now)}::timestamptz
      order by t.remind_at asc, t.id asc
      limit ${limit}
      for update of t skip locked
    ), u as (
      update hub.review_tasks t set reminded_at = ${iso(now)}::timestamptz
      from c where t.id = c.id and t.tenant_id = c.tenant_id
      returning t.id, t.tenant_id, t.process_run_id, t.stage_run_id, t.assignee_group_id, t.remind_at
    )
    select u.id, u.tenant_id, u.process_run_id, u.assignee_group_id as group_id,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name,
      array(select a.user_id::text from hub.review_task_assignees a
        where a.task_id = u.id and a.tenant_id = u.tenant_id and a.user_id is not null) as user_ids,
      array(select gm.user_id::text from admin.group_members gm
        where gm.group_id = u.assignee_group_id and gm.tenant_id = u.tenant_id) as member_ids,
      exists (select 1 from hub.review_tasks t2
        where t2.status = 'open' and t2.reminded_at is null and t2.remind_at <= ${iso(now)}::timestamptz
          and not exists (select 1 from c where c.id = t2.id)) as more
    from u
    left join hub.stage_runs s on s.id = u.stage_run_id and s.tenant_id = u.tenant_id
    left join hub.process_runs pr on pr.id = u.process_run_id and pr.tenant_id = u.tenant_id
    order by u.remind_at asc, u.id asc`);
  const tasks = rows.map((r) => ({
    taskId: r.id,
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    groupId: r.group_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
    userIds: r.user_ids ?? [],
    groupMemberIds: r.member_ids ?? [],
  }));
  return { tasks, more: rows[0]?.more === true };
}
export type NoticeRow = {
  tenantId: string;
  userId: string;
  processRunId: string;
  taskId: string | null;
  payload: Record<string, unknown>;
};
export type InsertedNoticeRow = InsertedNotice & { tenantId: string; row: NoticeRow };

export const unreadKey = (tenantId: string, userId: string): string => `${tenantId}:${userId}`;

/**
 * MỘT câu cố định cho cả lô: chèn notice (`jsonb_to_recordset` — một tham số JSON, văn bản SQL không đổi theo số hàng nên
 * mỗi kết nối chỉ chuẩn bị một lần) VÀ đếm chưa đọc của các cặp (tenant, user) trong lô. Câu chính của một câu có CTE ghi
 * dữ liệu đọc ảnh TRƯỚC khi chèn ⇒ unread = số chưa đọc trước + số notice vừa chèn cho cặp đó trong lô — bằng đúng số
 * `count(*)` sau khi chèn trong cùng tx (cách cũ). `id`, `createdAt` sinh app-side, một `createdAt` cho cả lô (thứ tự
 * `created_at desc, id desc` như `insertNotices`).
 */
export async function writeNotices(
  tx: Tx,
  kind: NoticeKind,
  rows: readonly NoticeRow[],
): Promise<{ inserted: InsertedNoticeRow[]; unread: Map<string, number> }> {
  if (rows.length === 0) return { inserted: [], unread: new Map() };
  const createdAt = new Date();
  const inserted = rows.map((r) => ({
    id: crypto.randomUUID(),
    userId: r.userId,
    tenantId: r.tenantId,
    createdAt,
    row: r,
  }));
  const json = JSON.stringify(
    inserted.map((n) => ({
      id: n.id,
      tenant_id: n.tenantId,
      user_id: n.userId,
      process_run_id: n.row.processRunId,
      task_id: n.row.taskId,
      payload: n.row.payload,
    })),
  );
  const before = await tx.execute<{ tenant_id: string; user_id: string; n: number | string }>(sql`
    with x as (
      select * from jsonb_to_recordset(${json}::jsonb)
        as x(id uuid, tenant_id uuid, user_id uuid, process_run_id uuid, task_id uuid, payload jsonb)
    ), ins as (
      insert into hub.process_notices (id, tenant_id, user_id, kind, process_run_id, task_id, payload, created_at)
      select id, tenant_id, user_id, ${kind}, process_run_id, task_id, payload, ${createdAt.toISOString()}::timestamptz
      from x
    )
    select n.tenant_id, n.user_id, count(*)::int as n from hub.process_notices n
    where n.user_id = any(array(select distinct user_id from x))
      and n.tenant_id = any(array(select distinct tenant_id from x)) and n.read_at is null
    group by n.tenant_id, n.user_id`);
  const unread = new Map(before.map((r) => [unreadKey(r.tenant_id, r.user_id), Number(r.n)]));
  for (const n of inserted) {
    const k = unreadKey(n.tenantId, n.userId);
    unread.set(k, (unread.get(k) ?? 0) + 1);
  }
  return { inserted, unread };
}
