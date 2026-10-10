// HUB-FR-112 · HUB-BR-25 · PF3 · `ProcessNotifier` (plan §9 "Ports", plan-contract §5): gọi TRONG tx của PF1/PF2 sau khi
// ghi task/notice; chèn `process_notices` + trả `UserEvent[]` (review_task.*, process.notice) để người gọi phát SAU COMMIT.
// Không đụng Redis. Người nhận = user assignee ∪ thành viên group của task (readiness #22: chèn notice chỉ qua đây).
import type { NoticeKind, ProcessNotice, TaskKind, TaskResult } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import type { UserEvent } from "../../../lib/user-stream";
import { processNotice, reviewTaskClosed, reviewTaskCreated } from "../core/events";
import type { ProcessNotifier } from "../core/ports";
import {
  groupMemberIds,
  type InsertedNotice,
  insertNotices,
  loadNoticeTask,
  loadRunForNotice,
  taskAssigneeUserIds,
  unreadByUser,
} from "./inbox.repo";
import { noticeRecipients } from "./notify.rules";

/** Kind notice khi MỞ task theo loại task (plan-contract §1 `NOTICE_KINDS`). */
const OPEN_NOTICE: Record<TaskKind, NoticeKind> = {
  review: "review_requested",
  ask: "ask_requested",
  decision: "decision_requested",
};

export type NoticeMeta = {
  processRunId: string;
  taskId: string | null;
  processName: string;
  stageName: string | null;
  result?: TaskResult | null;
};

/** Dựng `ProcessNotice` cho sự kiện `process.notice` (dùng lại ở `remindOnce`). Không chứa nội dung output/câu hỏi. */
export function buildNotice(n: InsertedNotice, kind: NoticeKind, m: NoticeMeta): ProcessNotice {
  return {
    id: n.id,
    kind,
    process_run_id: m.processRunId,
    task_id: m.taskId,
    process_name: m.processName,
    stage_name: m.stageName,
    ...(m.result ? { result: m.result } : {}),
    created_at: n.createdAt.toISOString(),
    read: false,
  };
}

/** Sự kiện `process.notice` cho từng notice vừa chèn (unread riêng mỗi người). */
async function noticeEvents(
  tx: Tx,
  tenantId: string,
  inserted: readonly InsertedNotice[],
  kind: NoticeKind,
  m: NoticeMeta,
): Promise<UserEvent[]> {
  const unread = await unreadByUser(
    tx,
    tenantId,
    inserted.map((n) => n.userId),
  );
  return inserted.flatMap((n) =>
    processNotice(n.userId, { notice: buildNotice(n, kind, m), unread: unread.get(n.userId) ?? 1 }),
  );
}

async function assignees(
  tx: Tx,
  tenantId: string,
  taskId: string,
  groupId: string | null,
): Promise<{ userIds: string[]; groupMemberIds: string[] }> {
  const userIds = await taskAssigneeUserIds(tx, tenantId, taskId);
  const members = groupId ? await groupMemberIds(tx, tenantId, groupId) : [];
  return { userIds, groupMemberIds: members };
}

async function onTaskOpened(tx: Tx, taskId: string): Promise<UserEvent[]> {
  const t = await loadNoticeTask(tx, taskId);
  if (!t) return [];
  const recipients = noticeRecipients(await assignees(tx, t.tenantId, taskId, t.groupId));
  if (recipients.length === 0) return [];
  const meta: NoticeMeta = {
    processRunId: t.processRunId,
    taskId,
    processName: t.processName,
    stageName: t.stageName,
  };
  const kind = OPEN_NOTICE[t.kind];
  const inserted = await insertNotices(tx, {
    tenantId: t.tenantId,
    kind,
    processRunId: t.processRunId,
    taskId,
    payload: { process_name: t.processName, stage_name: t.stageName },
    userIds: recipients,
  });
  return [
    ...reviewTaskCreated(recipients, {
      task_id: taskId,
      kind: t.kind,
      process_run_id: t.processRunId,
    }),
    ...(await noticeEvents(tx, t.tenantId, inserted, kind, meta)),
  ];
}

async function onTaskClosed(tx: Tx, taskId: string): Promise<UserEvent[]> {
  const t = await loadNoticeTask(tx, taskId);
  if (!t) return [];
  const facts = await assignees(tx, t.tenantId, taskId, t.groupId);
  const all = noticeRecipients(facts);
  const result: TaskResult = t.result ?? "pass";
  const events: UserEvent[] = [...reviewTaskClosed(all, { id: taskId, result })];
  // Không tự báo cho người vừa thao tác (decidedBy).
  const noticed = noticeRecipients(facts, t.decidedBy ?? undefined);
  if (noticed.length > 0) {
    const meta: NoticeMeta = {
      processRunId: t.processRunId,
      taskId,
      processName: t.processName,
      stageName: t.stageName,
      result,
    };
    const inserted = await insertNotices(tx, {
      tenantId: t.tenantId,
      kind: "task_closed",
      processRunId: t.processRunId,
      taskId,
      payload: { process_name: t.processName, stage_name: t.stageName, result },
      userIds: noticed,
    });
    events.push(...(await noticeEvents(tx, t.tenantId, inserted, "task_closed", meta)));
  }
  return events;
}

async function onRunFinished(tx: Tx, runId: string): Promise<UserEvent[]> {
  const r = await loadRunForNotice(tx, runId);
  if (!r) return [];
  const meta: NoticeMeta = {
    processRunId: runId,
    taskId: null,
    processName: r.processName,
    stageName: null,
  };
  const inserted = await insertNotices(tx, {
    tenantId: r.tenantId,
    kind: "run_finished",
    processRunId: runId,
    taskId: null,
    payload: { process_name: r.processName, stage_name: null },
    userIds: [r.startedBy],
  });
  return noticeEvents(tx, r.tenantId, inserted, "run_finished", meta);
}

export function createNotifier(): ProcessNotifier {
  return { taskOpened: onTaskOpened, taskClosed: onTaskClosed, runFinished: onRunFinished };
}
