// HUB-FR-112 · HUB-BR-25 · D12 · repo PF3 (plan §4 hàng nhắc, §5, §11; plan-contract §3 PF3): đọc `/me/review-tasks`,
// `/me/process-inbox`, chèn `process_notices` (chỉ qua đây — readiness #22: không route nào cho user tự chèn notice cho
// người khác), và truy vấn cho `ProcessNotifier`/`remindOnce`. Chạy trong `withHubScope`; mọi câu lọc `tenant_id` tường
// minh, RLS T là lưới. Không log nội dung.
import type { NoticeKind, ProcessRunStatus, TaskKind, TaskResult } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { processNotices } from "@ai/db/schema/hub-processes";
import { sql } from "drizzle-orm";
import type { ViewerCtx } from "../core/task-view";

type Ts = Date | string;
const uuidArray = (ids: readonly string[]): string => `{${ids.join(",")}}`;

export type Cursor = { at: Date; id: string };
const before = (cur: Cursor | undefined) =>
  cur
    ? sql`and (t.created_at, t.id) < (${cur.at.toISOString()}::timestamptz, ${cur.id}::uuid)`
    : sql``;
/** Lọc assignee của người xem: user trực tiếp hoặc group người xem thuộc (readiness #22: group từ cache người xem). */
const mine = (v: ViewerCtx) => sql`exists (
  select 1 from hub.review_task_assignees a
  where a.task_id = t.id and a.tenant_id = t.tenant_id
    and (a.user_id = ${v.userId}::uuid or a.group_id = any(${uuidArray([...v.groupIds])}::uuid[])))`;

// ── `/me/review-tasks` ──
export type TaskPageRow = {
  task_id: string;
  created_at: Ts;
  run_id: string;
  run_status: ProcessRunStatus;
  proc_key: string;
  proc_name: string;
  started_by: string;
  sb_display: string | null;
  sb_username: string | null;
};

/** Task gán cho người xem theo `status`, mới trước; trả `limit + 1` để biết còn trang. */
export async function listTaskPage(
  tx: Tx,
  v: ViewerCtx,
  q: { status: "open" | "closed"; limit: number; cursor?: Cursor },
): Promise<TaskPageRow[]> {
  return tx.execute<TaskPageRow>(sql`
    select t.id as task_id, t.created_at,
      pr.id as run_id, pr.status as run_status,
      pr.snapshot->>'key' as proc_key, pr.snapshot->>'name' as proc_name,
      pr.started_by, su.display_name as sb_display, su.username as sb_username
    from hub.review_tasks t
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    left join admin.users su on su.id = pr.started_by and su.tenant_id = t.tenant_id
    where t.tenant_id = ${v.tenantId} and t.status = ${q.status} and ${mine(v)} ${before(q.cursor)}
    order by t.created_at desc, t.id desc
    limit ${q.limit + 1}`);
}

/** `open_count` = số task mở của người xem, kẹp ở `cap` (LIMIT để không quét quá cap hàng). */
export async function openTaskCount(tx: Tx, v: ViewerCtx, cap: number): Promise<number> {
  const [row] = await tx.execute<{ n: number | string }>(sql`
    select count(*)::int as n from (
      select 1 from hub.review_tasks t
      where t.tenant_id = ${v.tenantId} and t.status = 'open' and ${mine(v)}
      limit ${cap}) x`);
  return Number(row?.n ?? 0);
}

// ── `/me/process-inbox` ──
export type NoticeRow = {
  id: string;
  kind: NoticeKind;
  process_run_id: string;
  task_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: Ts;
  read_at: Ts | null;
};

export async function listNotices(
  tx: Tx,
  v: { userId: string; tenantId: string },
  q: { limit: number; cursor?: Cursor },
): Promise<NoticeRow[]> {
  const cur = q.cursor
    ? sql`and (n.created_at, n.id) < (${q.cursor.at.toISOString()}::timestamptz, ${q.cursor.id}::uuid)`
    : sql``;
  return tx.execute<NoticeRow>(sql`
    select n.id, n.kind, n.process_run_id, n.task_id, n.payload, n.created_at, n.read_at
    from hub.process_notices n
    where n.user_id = ${v.userId} and n.tenant_id = ${v.tenantId} ${cur}
    order by n.created_at desc, n.id desc
    limit ${q.limit + 1}`);
}

export async function unreadNoticeCount(tx: Tx, userId: string, tenantId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number | string }>(sql`
    select count(*)::int as n from hub.process_notices
    where user_id = ${userId} and tenant_id = ${tenantId} and read_at is null`);
  return Number(r?.n ?? 0);
}

/** Notice `id` có thuộc về người xem không (else route 404). */
export async function noticeOwned(
  tx: Tx,
  userId: string,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const [r] = await tx.execute<{ n: number | string }>(sql`
    select 1 as n from hub.process_notices
    where id = ${id} and user_id = ${userId} and tenant_id = ${tenantId}`);
  return r !== undefined;
}

/**
 * Đánh dấu đã đọc mọi notice của người xem tạo ≤ notice `upToId` (gồm chính nó). So `created_at` TRONG SQL để giữ độ chính
 * xác micro-giây (JS `Date` chỉ mili-giây ⇒ truncate làm sót chính hàng mốc).
 */
export async function markNoticesRead(
  tx: Tx,
  userId: string,
  tenantId: string,
  upToId: string,
  now: Date,
): Promise<void> {
  await tx.execute(sql`
    update hub.process_notices set read_at = ${now.toISOString()}::timestamptz
    where user_id = ${userId} and tenant_id = ${tenantId} and read_at is null
      and created_at <= (select created_at from hub.process_notices
        where id = ${upToId} and user_id = ${userId} and tenant_id = ${tenantId})`);
}

// ── Dùng cho ProcessNotifier / remindOnce ──
export type NoticeTask = {
  tenantId: string;
  processRunId: string;
  kind: TaskKind;
  groupId: string | null;
  decidedBy: string | null;
  result: TaskResult | null;
  processName: string;
  stageName: string | null;
};

export async function loadNoticeTask(tx: Tx, taskId: string): Promise<NoticeTask | null> {
  const [r] = await tx.execute<{
    tenant_id: string;
    process_run_id: string;
    kind: TaskKind;
    group_id: string | null;
    decided_by: string | null;
    result: TaskResult | null;
    process_name: string | null;
    stage_name: string | null;
  }>(sql`
    select t.tenant_id, t.process_run_id, t.kind, t.assignee_group_id as group_id, t.decided_by, t.result,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    where t.id = ${taskId}`);
  if (!r) return null;
  return {
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    kind: r.kind,
    groupId: r.group_id,
    decidedBy: r.decided_by,
    result: r.result,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
  };
}

export async function loadRunForNotice(
  tx: Tx,
  runId: string,
): Promise<{ tenantId: string; startedBy: string; processName: string } | null> {
  const [r] = await tx.execute<{
    tenant_id: string;
    started_by: string;
    process_name: string | null;
  }>(sql`
    select tenant_id, started_by, snapshot->>'name' as process_name
    from hub.process_runs where id = ${runId}`);
  return r
    ? { tenantId: r.tenant_id, startedBy: r.started_by, processName: r.process_name ?? "" }
    : null;
}

export async function taskAssigneeUserIds(
  tx: Tx,
  tenantId: string,
  taskId: string,
): Promise<string[]> {
  const rows = await tx.execute<{ user_id: string }>(sql`
    select distinct user_id from hub.review_task_assignees
    where task_id = ${taskId} and tenant_id = ${tenantId} and user_id is not null`);
  return rows.map((r) => r.user_id);
}

/** Thành viên hiện tại của group (plan §11: một truy vấn; `admin.group_members` đọc được qua hub_ro). */
export async function groupMemberIds(tx: Tx, tenantId: string, groupId: string): Promise<string[]> {
  const rows = await tx.execute<{ user_id: string }>(sql`
    select user_id from admin.group_members where group_id = ${groupId} and tenant_id = ${tenantId}`);
  return rows.map((r) => r.user_id);
}

export type InsertedNotice = { userId: string; id: string; createdAt: Date };

/** Một hàng `process_notices` cho mỗi người nhận (INSERT theo tenant — người quyết ghi thông báo cho người khác). */
export async function insertNotices(
  tx: Tx,
  o: {
    tenantId: string;
    kind: NoticeKind;
    processRunId: string;
    taskId: string | null;
    payload: Record<string, unknown>;
    userIds: readonly string[];
  },
): Promise<InsertedNotice[]> {
  if (o.userIds.length === 0) return [];
  const rows = o.userIds.map((userId) => ({
    id: crypto.randomUUID(),
    tenantId: o.tenantId,
    userId,
    kind: o.kind,
    processRunId: o.processRunId,
    taskId: o.taskId,
    payload: o.payload,
  }));
  const res = await tx.insert(processNotices).values(rows).returning({
    userId: processNotices.userId,
    id: processNotices.id,
    createdAt: processNotices.createdAt,
  });
  return res.map((r) => ({ userId: r.userId, id: r.id, createdAt: r.createdAt }));
}

/** Tổng chưa đọc từng người (để `process.notice.unread`). */
export async function unreadByUser(
  tx: Tx,
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.execute<{ user_id: string; n: number | string }>(sql`
    select user_id, count(*)::int as n from hub.process_notices
    where tenant_id = ${tenantId} and user_id = any(${uuidArray(userIds)}::uuid[]) and read_at is null
    group by user_id`);
  return new Map(rows.map((r) => [r.user_id, Number(r.n)]));
}

export type DueTask = {
  taskId: string;
  tenantId: string;
  processRunId: string;
  groupId: string | null;
  processName: string;
  stageName: string | null;
};

/** Task mở, tới hạn (`remind_at ≤ now`), chưa nhắc — scope `system` thấy mọi tenant; LIMIT (plan §11 ≤ 100). */
export async function dueTasks(tx: Tx, now: Date, limit: number): Promise<DueTask[]> {
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    process_run_id: string;
    group_id: string | null;
    process_name: string | null;
    stage_name: string | null;
  }>(sql`
    select t.id, t.tenant_id, t.process_run_id, t.assignee_group_id as group_id,
      pr.snapshot->>'name' as process_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    where t.status = 'open' and t.reminded_at is null and t.remind_at <= ${now.toISOString()}::timestamptz
    order by t.remind_at asc, t.id asc
    limit ${limit}`);
  return rows.map((r) => ({
    taskId: r.id,
    tenantId: r.tenant_id,
    processRunId: r.process_run_id,
    groupId: r.group_id,
    processName: r.process_name ?? "",
    stageName: r.stage_name,
  }));
}

/** Đặt `reminded_at` (chỉ khi còn mở & chưa nhắc) ⇒ chạy lại không nhắc đôi. */
export async function markReminded(tx: Tx, taskId: string, now: Date): Promise<void> {
  await tx.execute(sql`
    update hub.review_tasks set reminded_at = ${now.toISOString()}::timestamptz
    where id = ${taskId} and status = 'open' and reminded_at is null`);
}
