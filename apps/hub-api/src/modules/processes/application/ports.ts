// HUB-FR-143…145 · CA-R05…R07 · spec-ca §4 · plan §3 · plan-addendum A7 Q4, A11: port lớp 2 của `processes` — CHỈ kiểu,
// chỉ import `domain/`. Không type nào chứa `Tx` (K1): repo đã gắn tx + `tenantId` của UoW. Sự kiện gom qua `Outbox`,
// adapter phát SAU COMMIT đúng một lần. Repo port theo nhóm (retry, side effect, team, review task…) thêm ở T7–T9.
import type { NoticeKind, ProcessRunStatus, Timer } from "../domain/types";

export type Clock = { now(): Date };
export type IdGen = { newId(): string };
export type Logger = {
  warn(m: string, f?: Record<string, unknown>): void;
  error(m: string, f?: Record<string, unknown>): void;
};
export type AppCtx = { clock: Clock; ids: IdGen; log: Logger };

/** `user_events`: `UserEvent` đã dựng ở adapter/code cũ — lớp 2 chỉ chuyển tiếp, không đọc. */
export type OutboxEvent =
  | { kind: "kick"; runId: string }
  | { kind: "post_thread"; runId: string }
  | { kind: "user_events"; events: readonly unknown[] };
/** Gom sự kiện trong tx; adapter phát SAU COMMIT, đúng một lần (bỏ gom của lần chạy lại 40P01/40001). */
export type Outbox = { emit(e: OutboxEvent): void };
/** CA-R07: tên nghiệp vụ trên `Outbox` ⇒ kick/đăng thread chỉ xảy ra sau COMMIT. */
export type StageKicker = { kick(runId: string): void };
export type Notifier = {
  postThread(runId: string): void;
  userEvents(events: readonly unknown[]): void;
};

// ── Repo theo hàng (scope `tenant` / `system(tenantId)`): mọi câu lọc `tenant_id` của UoW, kể cả scope system ──
export type RunLock = { id: string; tenantId: string; status: ProcessRunStatus };
export type RunRepo = {
  /** `select … for update` theo `(id, tenant_id)`; không thấy (tenant khác/không có) ⇒ `null`. Khoá run TRƯỚC timer. */
  lock(runId: string): Promise<RunLock | null>;
};
export type TimerRepo = {
  lockById(id: string): Promise<Timer | null>;
  /** Đặt `fired_at` khi hẹn còn mở; `false` ⇒ đã bắn/huỷ (không đổi gì). */
  markFired(id: string, now: Date): Promise<boolean>;
  /** Huỷ hẹn mở của run (mọi stage hoặc các stage chỉ định); trả số hẹn vừa huỷ. */
  cancelForRun(runId: string, stageRunIds: readonly string[] | "all", now: Date): Promise<number>;
};
export type TxRepos = {
  readonly tenantId: string;
  runs: RunRepo;
  timers: TimerRepo;
  outbox: Outbox;
  kicker: StageKicker;
  notifier: Notifier;
};

// ── Repo lô (chỉ `systemBatch`, A11): hàng mang `tenant_id` của hàng nguồn; join/insert khớp nó; SKIP LOCKED ──
export type ClaimedReminder = {
  taskId: string;
  tenantId: string;
  processRunId: string;
  groupId: string | null;
  processName: string;
  stageName: string | null;
  userIds: string[];
  groupMemberIds: string[];
};
/** `more`: còn hàng tới hạn ngoài lô ⇒ lượt xả chạy tiếp (không mở tx rỗng để biết đã hết). */
export type ReminderBatch = { tasks: ClaimedReminder[]; more: boolean };
export type ReviewTaskBatchRepo = {
  /** MỘT câu: khoá task mở tới hạn (SKIP LOCKED), đặt `reminded_at`, trả kèm tên + người nhận. */
  claimDueReminders(limit: number, now: Date): Promise<ReminderBatch>;
};
export type NoticeRow = {
  tenantId: string;
  userId: string;
  processRunId: string;
  taskId: string | null;
  payload: Record<string, unknown>;
};
export type InsertedNoticeRow = {
  id: string;
  userId: string;
  tenantId: string;
  createdAt: Date;
  row: NoticeRow;
};
export type NoticeBatchWriter = {
  /** MỘT câu: chèn notice + đếm chưa đọc; `unread` khoá `${tenantId}:${userId}`. */
  insertMany(
    kind: NoticeKind,
    rows: readonly NoticeRow[],
  ): Promise<{ inserted: InsertedNoticeRow[]; unread: Map<string, number> }>;
};
export type FinishedRun = { id: string; tenantId: string; startedBy: string; processName: string };
export type ExpiredRun = FinishedRun & { originKind: string; roomId: string | null };
export type RunBatchRepo = {
  /** MỘT câu: khoá run quá hạn (SKIP LOCKED), đặt `expired`, huỷ stage mở, đóng task mở. */
  claimExpired(limit: number, now: Date): Promise<{ runs: ExpiredRun[]; more: boolean }>;
};
export type ThreadBatchWriter = { insertRunEnds(runs: readonly ExpiredRun[]): Promise<void> };
export type BatchNotifier = {
  /** Notice `run_finished` + unread chèn TRONG tx (2 câu cho cả lô); sự kiện Redis vào outbox (#90). */
  runsFinished(runs: readonly FinishedRun[]): Promise<void>;
};
export type BatchRepos = {
  reviewTasks: ReviewTaskBatchRepo;
  notices: NoticeBatchWriter;
  runs: RunBatchRepo;
  threads: ThreadBatchWriter;
  notifier: BatchNotifier;
  outbox: Outbox;
};

export type UnitOfWork = {
  /** Request người dùng: `withHubScope({kind:"user", tenantId, userId})` (RLS) + repo lọc `tenantId`. */
  tenant<T>(who: { tenantId: string; userId: string }, fn: (r: TxRepos) => Promise<T>): Promise<T>;
  /** Vòng nền theo hàng: scope `system`; repo gắn `tenantId`, MỌI câu lọc `tenant_id` tường minh (CA-R06). */
  system<T>(tenantId: string, fn: (r: TxRepos) => Promise<T>): Promise<T>;
  /** CHỈ vòng nền theo tập (nhắc, chuyển cấp, hết hạn — CR-093, A11): một tx scope `system` mỗi lô. */
  systemBatch<T>(fn: (r: BatchRepos) => Promise<T>): Promise<T>;
};
