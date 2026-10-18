// HUB-FR-112 · HUB-FR-115 · CR-093 · plan-addendum A10/A11 · TECH-DEBT #190 · truy vấn THEO TẬP cho vòng nền (nhắc, hết
// hạn): mỗi lô vài câu SQL cố định, không phụ thuộc số hàng. Scope `system` (một tx mỗi lô, nhiều tenant): mọi join/insert
// khớp `tenant_id` của hàng nguồn (K3 bản lô, A11); khoá `FOR UPDATE SKIP LOCKED` ⇒ nhiều Hub chạy song song không xử lý
// trùng hàng. Chỉ làm việc DB; người gọi phát sự kiện SAU COMMIT.
import type { NoticeKind } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { processNotices } from "@ai/db/schema/hub-processes";
import { sql } from "drizzle-orm";
import type { InsertedNotice } from "./inbox.repo";

const uuidArray = (ids: readonly string[]): string => `{${ids.join(",")}}`;
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

/**
 * MỘT câu: khoá task mở tới hạn chưa nhắc (cũ trước, bỏ qua hàng Hub khác đang khoá — #190), đặt `reminded_at` (đúng 1
 * lần — HUB-BR-26), trả kèm tên quy trình/bước và người nhận (user assignee, thành viên group hiện tại). Người nhận lấy
 * bằng subquery tương quan theo PK/index (`review_task_assignees_user_uq`, `group_members_pkey`) — 100 lần tra index,
 * không join theo thống kê; mọi điều kiện khớp `tenant_id` của task nguồn (K3 lô, A11).
 */
export async function claimDueReminders(
  tx: Tx,
  now: Date,
  limit: number,
): Promise<ClaimedReminder[]> {
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    process_run_id: string;
    group_id: string | null;
    process_name: string | null;
    stage_name: string | null;
    user_ids: string[] | null;
    member_ids: string[] | null;
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
        where gm.group_id = u.assignee_group_id and gm.tenant_id = u.tenant_id) as member_ids
    from u
    left join hub.stage_runs s on s.id = u.stage_run_id and s.tenant_id = u.tenant_id
    left join hub.process_runs pr on pr.id = u.process_run_id and pr.tenant_id = u.tenant_id
    order by u.remind_at asc, u.id asc`);
  return rows.map((r) => ({
    taskId: r.id,
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    groupId: r.group_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
    userIds: r.user_ids ?? [],
    groupMemberIds: r.member_ids ?? [],
  }));
}
export type NoticeRow = {
  tenantId: string;
  userId: string;
  processRunId: string;
  taskId: string | null;
  payload: Record<string, unknown>;
};
export type InsertedNoticeRow = InsertedNotice & { tenantId: string; row: NoticeRow };

/**
 * MỘT câu INSERT nhiều hàng (không RETURNING — cùng lý do `insertNotices`: policy SELECT chỉ thấy hàng của mình). `id`,
 * `createdAt` sinh app-side, một `createdAt` cho cả lô.
 */
export async function insertNoticeRows(
  tx: Tx,
  kind: NoticeKind,
  rows: readonly NoticeRow[],
): Promise<InsertedNoticeRow[]> {
  if (rows.length === 0) return [];
  const createdAt = new Date();
  const values = rows.map((r) => ({
    id: crypto.randomUUID(),
    tenantId: r.tenantId,
    userId: r.userId,
    kind,
    processRunId: r.processRunId,
    taskId: r.taskId,
    payload: r.payload,
    createdAt,
  }));
  await tx.insert(processNotices).values(values);
  return values.map((v, i) => ({
    id: v.id,
    userId: v.userId,
    tenantId: v.tenantId,
    createdAt,
    row: rows[i] as NoticeRow,
  }));
}

export const unreadKey = (tenantId: string, userId: string): string => `${tenantId}:${userId}`;

/** MỘT câu: tổng chưa đọc theo cặp (tenant, user) của lô (`process_notices_unread_idx`). */
export async function unreadByTenantUser(
  tx: Tx,
  pairs: readonly { tenantId: string; userId: string }[],
): Promise<Map<string, number>> {
  const uniq = [...new Map(pairs.map((p) => [unreadKey(p.tenantId, p.userId), p])).values()];
  if (uniq.length === 0) return new Map();
  const rows = await tx.execute<{ tenant_id: string; user_id: string; n: number | string }>(sql`
    select tenant_id, user_id, count(*)::int as n from hub.process_notices
    where user_id = any(${uuidArray([...new Set(uniq.map((p) => p.userId))])}::uuid[])
      and tenant_id = any(${uuidArray([...new Set(uniq.map((p) => p.tenantId))])}::uuid[]) and read_at is null
    group by tenant_id, user_id`);
  return new Map(rows.map((r) => [unreadKey(r.tenant_id, r.user_id), Number(r.n)]));
}
