// HUB-FR-104…113 · repo lõi quy trình dùng chung mọi PF (plan §8 hàng 0b khung, §10 thứ tự khoá): khoá/đọc run, chèn/đóng
// task + grant, outbox tin thread. Chạy trong `withHubScope`; mọi câu lọc `tenant_id` tường minh khi có, RLS T là lưới.
// Không log nội dung.
import type { DecisionReason, RoomProcessKind, TaskKind, TaskResult } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import {
  processRuns,
  processThreadEvents,
  reviewTaskAssignees,
  reviewTasks,
} from "@ai/db/schema/hub-processes";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { FanoutRow } from "../../rooms/room-events";

export type RunHead = typeof processRuns.$inferSelect;

/** §10 · `process_runs` FOR UPDATE (sau `rooms`/advisory nếu có, trước `stage_runs`). null = không thấy (RLS/tenant). */
export async function lockRun(tx: Tx, tenantId: string, runId: string): Promise<RunHead | null> {
  const [row] = await tx
    .select()
    .from(processRuns)
    .where(and(eq(processRuns.id, runId), eq(processRuns.tenantId, tenantId)))
    .for("update");
  return row ?? null;
}

/**
 * HUB-FR-112 · người nhận `process.updated` (plan-contract §5): người bắt đầu + thành viên đang hoạt động của phòng
 * nguồn + assignee (user + thành viên group) các task **open**. Gọi TRƯỚC khi đóng task (để assignee task vừa đóng vẫn
 * nhận). Lọc `tenant_id` tường minh (policy `admin.group_members` hub_ro = USING true, không khoá tenant).
 */
export async function runRecipients(tx: Tx, runId: string, tenantId: string): Promise<string[]> {
  const rows = await tx.execute<{ uid: string | null }>(sql`
    select r.started_by as uid from hub.process_runs r
      where r.id = ${runId} and r.tenant_id = ${tenantId}
    union
    select m.user_id as uid from hub.room_members m
      join hub.process_runs r on r.id = ${runId} and r.tenant_id = ${tenantId}
      where r.origin_kind = 'room' and m.room_id = r.origin_room_id and m.tenant_id = ${tenantId}
        and m.left_at is null
    union
    select a.user_id as uid from hub.review_task_assignees a
      join hub.review_tasks t on t.id = a.task_id and t.tenant_id = a.tenant_id
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.status = 'open'
        and a.user_id is not null
    union
    select gm.user_id as uid from hub.review_tasks t
      join admin.group_members gm on gm.group_id = t.assignee_group_id and gm.tenant_id = ${tenantId}
      where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.status = 'open'
        and t.assignee_group_id is not null`);
  return rows.map((r) => r.uid).filter((x): x is string => x !== null);
}

/** Đọc đầu run không khoá. */
export async function loadRunHead(
  tx: Tx,
  tenantId: string,
  runId: string,
): Promise<RunHead | null> {
  const [row] = await tx
    .select()
    .from(processRuns)
    .where(and(eq(processRuns.id, runId), eq(processRuns.tenantId, tenantId)));
  return row ?? null;
}

export type NewTask = {
  tenantId: string;
  runId: string;
  stageRunId: string;
  kind: TaskKind;
  remindAt: Date;
  outputId?: string | null;
  question?: string | null;
  choices?: string[] | null;
  excerpt?: string | null;
  reason?: DecisionReason | null;
  /** Grant: user (`via=initial`) + tối đa một group. */
  userIds: readonly string[];
  groupId: string | null;
};

/** Mở task + grant (plan-step0 §1: PF1 `open_review/open_ask/open_decision`). Trả id task. */
export async function insertTask(tx: Tx, t: NewTask): Promise<string> {
  const id = crypto.randomUUID();
  await tx.insert(reviewTasks).values({
    id,
    tenantId: t.tenantId,
    processRunId: t.runId,
    stageRunId: t.stageRunId,
    kind: t.kind,
    outputId: t.outputId ?? null,
    question: t.question ?? null,
    choices: t.choices ?? null,
    excerpt: t.excerpt ?? null,
    reason: t.reason ?? null,
    assigneeGroupId: t.groupId,
    remindAt: t.remindAt,
  });
  const grant = { tenantId: t.tenantId, taskId: id, via: "initial" as const, depth: 0 };
  const rows = [
    ...[...new Set(t.userIds)].map((userId) => ({ ...grant, userId })),
    ...(t.groupId ? [{ ...grant, groupId: t.groupId }] : []),
  ];
  if (rows.length > 0) await tx.insert(reviewTaskAssignees).values(rows);
  return id;
}

export type CloseTask = {
  result: TaskResult;
  at: Date;
  decidedBy?: string | null;
  feedback?: string | null;
  answer?: string | null;
  sections?: string[] | null;
};

/** §3.4 · khoá đóng: `status='open'` ⇒ đầu thắng; false ⇒ người gọi trả 409 `REVIEW_TASK_CLOSED`. */
export async function closeTask(tx: Tx, taskId: string, c: CloseTask): Promise<boolean> {
  const rows = await tx
    .update(reviewTasks)
    .set({
      status: "closed",
      result: c.result,
      decidedBy: c.decidedBy ?? null,
      decidedAt: c.at,
      feedback: c.feedback ?? null,
      answer: c.answer ?? null,
      sections: c.sections ?? null,
    })
    .where(and(eq(reviewTasks.id, taskId), eq(reviewTasks.status, "open")))
    .returning({ id: reviewTasks.id });
  return rows.length > 0;
}

// ── Outbox tin thread (plan-thread T5) ──

export type ThreadTarget = {
  tenantId: string;
  originKind: string;
  roomId: string | null;
  name: string;
};

/** Nơi đăng tin thread của run (đọc dưới scope người làm, RLS T). */
export async function threadTarget(tx: Tx, runId: string): Promise<ThreadTarget | null> {
  const [row] = await tx
    .select({
      tenantId: processRuns.tenantId,
      originKind: processRuns.originKind,
      roomId: processRuns.originRoomId,
      name: sql<string>`${processRuns.snapshot}->>'name'`,
    })
    .from(processRuns)
    .where(eq(processRuns.id, runId));
  return row ?? null;
}

export type NewThreadEvent = {
  id: string;
  tenantId: string;
  runId: string;
  roomId: string;
  kind: RoomProcessKind;
  meta: Record<string, unknown>;
  content: string;
};

/**
 * INSERT không RETURNING (SELECT chỉ `system`). `created_at = clock_timestamp()`: nhiều sự kiện trong một tx vẫn đúng thứ
 * tự đăng (`now()` của tx bằng nhau).
 */
export async function insertThreadEvent(tx: Tx, e: NewThreadEvent): Promise<void> {
  await tx.insert(processThreadEvents).values({
    id: e.id,
    tenantId: e.tenantId,
    processRunId: e.runId,
    roomId: e.roomId,
    kind: e.kind,
    placement: e.kind === "block" ? "main" : "flow",
    meta: e.meta,
    content: e.content,
    createdAt: sql`clock_timestamp()`,
  });
}

/** Sự kiện chưa đăng, cũ trước (`process_thread_events_unposted_idx`); `runId` ⇒ chỉ của run đó. Scope `system`. */
export async function unpostedEvents(
  tx: Tx,
  limit: number,
  runId?: string,
): Promise<{ id: string; runId: string }[]> {
  const t = processThreadEvents;
  const where = runId ? and(isNull(t.postedAt), eq(t.processRunId, runId)) : isNull(t.postedAt);
  return tx
    .select({ id: t.id, runId: t.processRunId })
    .from(t)
    .where(where)
    .orderBy(asc(t.createdAt), asc(t.id))
    .limit(limit);
}

export type PostedEvent = {
  posted: boolean;
  reason: "posted" | "already" | "skipped";
  roomId: string;
  seq: number | null;
  createdAt: Date | null;
};

/** Definer `hub.room_post_process_message` (khoá rooms → sự kiện → room_messages; idempotent `id = event.id`). */
export async function postProcessMessage(tx: Tx, eventId: string): Promise<PostedEvent> {
  const [row] = await tx.execute<{
    posted: boolean;
    reason: PostedEvent["reason"];
    room_id: string;
    seq: number | string | null;
    created_at: Date | string | null;
  }>(sql`select * from hub.room_post_process_message(${eventId}::uuid)`);
  if (!row) throw new Error("room_post_process_message returned no row");
  return {
    posted: row.posted,
    reason: row.reason,
    roomId: row.room_id,
    seq: row.seq === null ? null : Number(row.seq),
    createdAt: row.created_at === null ? null : new Date(row.created_at),
  };
}

export type EventMessage = {
  id: string;
  roomId: string;
  runId: string;
  kind: RoomProcessKind;
  placement: "main" | "flow";
  meta: Record<string, unknown>;
  content: string;
  senderId: string;
  flowId: string;
  name: string;
};

/** Dữ liệu dựng `RoomMessage` của tin vừa đăng (scope `system`: `room_messages` không đọc được, dựng từ sự kiện). */
export async function eventMessage(tx: Tx, eventId: string): Promise<EventMessage | null> {
  const e = processThreadEvents;
  const [row] = await tx
    .select({
      id: e.id,
      roomId: e.roomId,
      runId: e.processRunId,
      kind: e.kind,
      placement: e.placement,
      meta: e.meta,
      content: e.content,
      senderId: processRuns.processDefId,
      flowId: processRuns.flowId,
      name: sql<string>`${processRuns.snapshot}->>'name'`,
    })
    .from(e)
    .innerJoin(
      processRuns,
      and(eq(processRuns.id, e.processRunId), eq(processRuns.tenantId, e.tenantId)),
    )
    .where(eq(e.id, eventId));
  return row ?? null;
}

/** Chưa đọc của phòng + tổng chưa đọc từng thành viên hiện tại (definer `room_fanout_sys`, cùng tx đăng). */
export async function fanoutSys(tx: Tx, roomId: string): Promise<FanoutRow[]> {
  const rows = await tx.execute<{
    user_id: string;
    unread: number | string;
    total: number | string;
  }>(sql`select user_id, unread, total from hub.room_fanout_sys(${roomId}::uuid)`);
  return rows.map((r) => ({
    user_id: r.user_id,
    unread: Number(r.unread),
    total: Number(r.total),
  }));
}
