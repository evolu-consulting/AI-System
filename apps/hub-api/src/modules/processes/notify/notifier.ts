// HUB-FR-112 · HUB-BR-25 · PF3 · `ProcessNotifier` (plan §9 "Ports", plan-contract §5): gọi TRONG tx của PF1/PF2 sau khi
// ghi task/notice; chèn `process_notices` + trả `UserEvent[]` (review_task.*, process.notice) để người gọi phát SAU COMMIT.
// Không đụng Redis. Người nhận = user assignee ∪ thành viên group của task (readiness #22: chèn notice chỉ qua đây).
import type { NoticeKind, ProcessNotice, TaskKind, TaskResult } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import type { UserEvent } from "../../../lib/user-stream";
import { processNotice, reviewTaskClosed, reviewTaskCreated } from "../core/events";
import type { FinishedRun, ProcessNotifier } from "../core/ports";
import { noticeRecipients } from "../domain/notify/remind.rules";
import { unreadKey, writeNotices } from "./batch.repo";
import {
  type InsertedNotice,
  insertNotices,
  loadNoticeTask,
  loadRunForNotice,
  unreadByUser,
} from "./inbox.repo";

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
  /** P-d2 · D2-47 · chỉ `escalated`. */
  group?: { id: string; name: string };
  afterH?: number;
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
    ...(m.group && { group: m.group }),
    ...(m.afterH !== undefined && { after_h: m.afterH }),
  };
}

/** Sự kiện `process.notice` cho từng notice vừa chèn (unread riêng mỗi người). */
async function noticeEvents(
  tx: Tx,
  a: { tenantId: string; inserted: readonly InsertedNotice[]; kind: NoticeKind; meta: NoticeMeta },
): Promise<UserEvent[]> {
  const unread = await unreadByUser(
    tx,
    a.tenantId,
    a.inserted.map((n) => n.userId),
  );
  return noticeEventsOf(a.inserted, a.kind, a.meta, unread);
}

function noticeEventsOf(
  inserted: readonly InsertedNotice[],
  kind: NoticeKind,
  meta: NoticeMeta,
  unread: Map<string, number>,
): UserEvent[] {
  return inserted.flatMap((n) =>
    processNotice(n.userId, {
      notice: buildNotice(n, kind, meta),
      unread: unread.get(n.userId) ?? 1,
    }),
  );
}

// T19-perf vòng 2 · `loadNoticeTask` trả luôn người nhận (assignee ∪ thành viên group) trong CÙNG câu.
async function onTaskOpened(tx: Tx, taskId: string): Promise<UserEvent[]> {
  const t = await loadNoticeTask(tx, taskId);
  if (!t) return [];
  const recipients = noticeRecipients(t);
  if (recipients.length === 0) return [];
  const meta: NoticeMeta = {
    processRunId: t.processRunId,
    taskId,
    processName: t.processName,
    stageName: t.stageName,
  };
  const kind = OPEN_NOTICE[t.kind];
  // INSERT ∥ đếm chưa đọc gửi liền (pipeline; câu đếm chạy SAU câu chèn cùng tx ⇒ đã tính notice mới).
  const [inserted, unread] = await Promise.all([
    insertNotices(tx, {
      tenantId: t.tenantId,
      kind,
      processRunId: t.processRunId,
      taskId,
      payload: { process_name: t.processName, stage_name: t.stageName },
      userIds: recipients,
    }),
    unreadByUser(tx, t.tenantId, recipients),
  ]);
  return [
    ...reviewTaskCreated(recipients, {
      task_id: taskId,
      kind: t.kind,
      process_run_id: t.processRunId,
    }),
    ...noticeEventsOf(inserted, kind, meta, unread),
  ];
}

async function onTaskClosed(tx: Tx, taskId: string): Promise<UserEvent[]> {
  const t = await loadNoticeTask(tx, taskId);
  if (!t) return [];
  const all = noticeRecipients(t);
  const result: TaskResult = t.result ?? "pass";
  const events: UserEvent[] = [...reviewTaskClosed(all, { id: taskId, result })];
  // Không tự báo cho người vừa thao tác (decidedBy).
  const noticed = noticeRecipients(t, t.decidedBy ?? undefined);
  if (noticed.length > 0) {
    const meta: NoticeMeta = {
      processRunId: t.processRunId,
      taskId,
      processName: t.processName,
      stageName: t.stageName,
      result,
    };
    // T19-perf · INSERT ∥ đếm chưa đọc gửi liền (pipeline): câu đếm chạy SAU câu chèn trên cùng tx ⇒ đã tính notice mới.
    const [inserted, unread] = await Promise.all([
      insertNotices(tx, {
        tenantId: t.tenantId,
        kind: "task_closed",
        processRunId: t.processRunId,
        taskId,
        payload: { process_name: t.processName, stage_name: t.stageName, result },
        userIds: noticed,
      }),
      unreadByUser(tx, t.tenantId, noticed),
    ]);
    events.push(...noticeEventsOf(inserted, "task_closed", meta, unread));
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
  return noticeEvents(tx, { tenantId: r.tenantId, inserted, kind: "run_finished", meta });
}

/** CR-093 · bản lô của `onRunFinished`: MỘT câu SQL (chèn + unread) cho cả lô, không phụ thuộc số run. */
async function onRunsFinished(tx: Tx, runs: readonly FinishedRun[]): Promise<UserEvent[]> {
  const { inserted, unread } = await writeNotices(
    tx,
    "run_finished",
    runs.map((r) => ({
      tenantId: r.tenantId,
      userId: r.startedBy,
      processRunId: r.id,
      taskId: null,
      payload: { process_name: r.processName, stage_name: null },
    })),
  );
  return inserted.flatMap((n) =>
    processNotice(n.userId, {
      notice: buildNotice(n, "run_finished", {
        processRunId: n.row.processRunId,
        taskId: null,
        processName: String(n.row.payload.process_name ?? ""),
        stageName: null,
      }),
      unread: unread.get(unreadKey(n.tenantId, n.userId)) ?? 1,
    }),
  );
}

export function createNotifier(): ProcessNotifier {
  return {
    taskOpened: onTaskOpened,
    taskClosed: onTaskClosed,
    runFinished: onRunFinished,
    runsFinished: onRunsFinished,
  };
}
