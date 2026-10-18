// HUB-FR-143…145 · CA-R05…R07 · spec-ca §4 · plan §3 · plan-addendum A7 Q4, A11: port lớp 2 của `processes` — CHỈ kiểu,
// chỉ import `domain/`. Không type nào chứa `Tx` (K1): repo đã gắn tx + `tenantId` của UoW. Sự kiện gom qua `Outbox`,
// adapter phát SAU COMMIT đúng một lần. Repo port theo nhóm (retry, side effect, team, review task…) thêm ở T7–T9.
import type { BranchRule } from "../domain/branch/branch-def.rules";
import type { RetryState } from "../domain/runs/retry.rules";
import type {
  NoticeKind,
  ProcessRunStatus,
  StageRunStatus,
  Timer,
  TimerKind,
} from "../domain/types";
import type { ToolStageRepo } from "./tools/tool.ports";

export type Clock = { now(): Date };
/**
 * Đồng hồ đo thời lượng (ms) — adapter cấp `monotonicMs` (`performance.now`); lớp 2 chỉ trừ hai mốc. Vắng (cổng giả chỉ có
 * `now`) ⇒ đo bằng `now()`.
 */
export type MonotonicClock = Clock & { monotonicMs?(): number };
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
  /** Kèm `timezone` IANA đã chốt trên hàng hẹn (`wait_until`; `null` ⇒ retry) — một câu khoá, khỏi đọc lẻ (#9). */
  lockById(id: string): Promise<(Timer & { timezone: string | null }) | null>;
  /** Đặt `fired_at` khi hẹn còn mở; `false` ⇒ đã bắn/huỷ (không đổi gì). */
  markFired(id: string, now: Date): Promise<boolean>;
  /** Huỷ hẹn mở của run (mọi stage hoặc các stage chỉ định); trả số hẹn vừa huỷ. */
  cancelForRun(runId: string, stageRunIds: readonly string[] | "all", now: Date): Promise<number>;
  /** T7 · số hẹn loại `kind` của stage (mọi attempt/round, cả đã bắn/huỷ) — `n` của khoá idempotency (A7 Q9). */
  countByStageKind(stageRunId: string, kind: TimerKind): Promise<number>;
  /** T7 · ghi hẹn mới (khoá trùng ⇒ không ghi, idempotent). Gọi SAU khi đã khoá run + ghi stage (thứ tự khoá plan §6). */
  insert(t: NewTimer): Promise<void>;
};
export type NewTimer = {
  runId: string;
  stageRunId: string;
  kind: TimerKind;
  dueAt: Date;
  key: string;
  /** IANA cho `wait_until` (D-PD07); `retry` ⇒ null. */
  timezone: string | null;
};
/** T8b · stage của hẹn đã khoá (`for update`, SAU run, TRƯỚC timer — plan §6). */
export type TimerStage = { id: string; status: StageRunStatus };
/**
 * T8b · PD-R11/R15 · hiệu ứng bắn hẹn lên stage; mọi câu lọc `(id, process_run_id, tenant_id)`. Sự kiện/kick vào outbox
 * (phát SAU COMMIT). Gọi trong tx đã khoá run. `finishWait` cũng là seam cho `enter-wait` (T8a) khi `due_at ≤ now`.
 */
export type StageTimerRepo = {
  lockStage(runId: string, stageRunId: string): Promise<TimerStage | null>;
  /** `retry` tới hạn: stage `queued`, `current_run_id = NULL` (cùng attempt) + `process_updated`. */
  requeue(runId: string, stageRunId: string, now: Date): Promise<void>;
  /** `wait_until` tới hạn: ghi .md "Đã chờ tới …" + stage `done` + join bước (P-b2); kick/thread/sự kiện vào outbox. */
  finishWait(
    runId: string,
    stageRunId: string,
    w: { dueAt: Date; timezone: string },
  ): Promise<void>;
};
/** T7 · bộ đếm thử lại của `stage_runs` (PD-R03/R06) — mọi câu lọc `(id, tenant_id)`. */
export type RetryRepo = {
  /** `null` ⇒ không thấy stage (tenant khác / đã xoá). */
  loadRetryState(stageRunId: string): Promise<RetryState | null>;
  /** Stage ⇒ `waiting_timer`, `current_run_id = NULL`, ghi bộ đếm + mã lỗi cuối (một câu). */
  markWaiting(
    stageRunId: string,
    w: { retryCount: number; attempt: number; round: number; lastErrorCode: string; now: Date },
  ): Promise<void>;
  /** PD-R04 · effect `reset_retry`: `retry_count = 0`, `last_error_code = NULL` (giữ `retry_since`). */
  resetRetry(stageRunId: string): Promise<void>;
};
/** T7 · K6 · D-PD03: job của stage đã gửi tool `side_effect` từ đầu attempt/round hiện tại? */
export type SideEffectProbe = { sent(stageRunId: string): Promise<boolean> };
/** T7b · PD-R08 · hàng `hub.team_runs` của stage nhóm (lọc `(id, tenant_id)`); gọi SAU khi đã ghi/khoá stage (plan §6). */
export type TeamRunRepo = {
  /** Thử lại: giữ `running` + `plan`, chốt `active_ms` tới `now` (Clock), `segment_started_at = NULL`, `cursor = max(cursor,0)`. */
  pauseForRetry(teamRunId: string, cursor: number, now: Date): Promise<void>;
  /** Quyết định (không thử lại): chốt `active_ms`, `failed`/`member_failed` + `finished_at`. */
  markFailed(teamRunId: string, now: Date): Promise<void>;
};
/** P-d2 T19s · trạng thái join bước đọc trong tx đã khoá `process_runs` (plan-d2 §3, §7). */
export type StepJoinLoad = {
  step: number;
  /** Bước của từng stage theo snapshot (`resolveSteps`, def cũ không `step` ⇒ mỗi stage một bước). */
  steps: readonly number[];
  statuses: ReadonlyMap<number, StageRunStatus>;
  /** `executor.kind` của từng stage theo snapshot (PD-R15: suy loại hẹn). */
  executorKinds: readonly (string | undefined)[];
  /** P-d2 T19 · `after.branch` của từng stage theo snapshot (đã map `goto_step` ⇒ `gotoStep`; vắng ⇒ `[]`). */
  branches: readonly (readonly BranchRule[])[];
};
/** P-d2 T19 · PD2-R14 · sự kiện rẽ nhánh (thread `branch` + audit `branch` actor hệ thống). `rule` đếm từ 1. */
export type BranchEvent = { stageIdx: number; fromStep: number; toStep: number; rule: number };
/** P-d2 T19s · D2-16 · ghi join bước; mọi câu lọc `(process_run_id|id, tenant_id)`. Gọi trong tx đã khoá run. */
export type StepRepo = {
  /** 2 câu: đầu run (`current_step`, snapshot) + trạng thái mọi stage. `null` ⇒ không thấy run. */
  loadJoin(runId: string): Promise<StepJoinLoad | null>;
  /** 2 câu: stage `idxs` ⇒ `queued`; run `running`, `current_step = step`, `current_stage_idx = first`. */
  queueStep(
    runId: string,
    q: { idxs: readonly number[]; step: number; first: number },
  ): Promise<void>;
  /** 1 câu: run `done` + `finished_at`, `current_stage_idx = first`. */
  finish(runId: string, first: number): Promise<void>;
  /** 1 câu: trạng thái run tổng hợp của bước + `current_stage_idx = first`. */
  setStatus(runId: string, status: ProcessRunStatus, first: number): Promise<void>;
  /** T19 · 1 câu: `fields` của output hiện hành của stage (không phải object / không output ⇒ `null`). */
  currentFields(
    runId: string,
    stageIdx: number,
  ): Promise<Readonly<Record<string, string | number>> | null>;
  /** T19 · 1 câu theo tập: stage `idxs` còn `pending`/`queued` ⇒ `skipped` + `finished_at`; trả id stage vừa nhảy. */
  skipStages(runId: string, idxs: readonly number[]): Promise<string[]>;
  /** T19 · 1 câu theo tập: huỷ hẹn mở của các stage vừa nhảy (Q-D2-3: phòng thủ, thường 0 hàng). */
  cancelTimers(runId: string, stageRunIds: readonly string[], now: Date): Promise<void>;
  /** T19 · 1 câu: audit `branch` + sự kiện thread `branch` (chỉ run bắt đầu từ phòng); đăng bởi poster SAU COMMIT. */
  branchEvent(runId: string, e: BranchEvent): Promise<void>;
};
export type TxRepos = {
  readonly tenantId: string;
  runs: RunRepo;
  timers: TimerRepo;
  stageTimers: StageTimerRepo;
  retry: RetryRepo;
  sideEffect: SideEffectProbe;
  team: TeamRunRepo;
  /** P-d2 · D2-11 · stage `tool` (`tool.ports.ts`). */
  tools: ToolStageRepo;
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
  remindAt: Date;
  remindedAt: Date | null;
  remindEveryH: number | null;
  remindCount: number;
};
/**
 * `more`: còn hàng tới hạn ngoài lô ⇒ lượt xả chạy tiếp (không mở tx rỗng để biết đã hết). `claimed`: số task đã khoá kể
 * cả task bị bỏ vì run đang bị tx khác giữ (T12 #1) — điều kiện "lô đầy" dùng số này để không dừng xả sớm.
 */
export type ReminderBatch = { tasks: ClaimedReminder[]; claimed: number; more: boolean };
/** Mốc nhắc kế (lớp 1 `nextRemind`; nhắc cũ giữ nguyên `remindAt`/`remindCount`). */
export type ReminderMark = {
  taskId: string;
  tenantId: string;
  remindAt: Date;
  remindCount: number;
};
export type ClaimedEscalation = {
  taskId: string;
  tenantId: string;
  processRunId: string;
  fromGroupId: string | null;
  toGroupId: string;
  /** Tenant của Group đích khi tìm thấy CÙNG tenant task; null = không tồn tại / khác tenant (K4). */
  groupTenantId: string | null;
  processName: string;
  stageName: string | null;
  memberIds: string[];
  /** P-d2 · D2-47 · tên Group đích (`name.vi`) + `after.escalate.after_h` của snapshot — vào payload notice `escalated`. */
  groupName?: string | null;
  afterH?: number | null;
};
/** Như `ReminderBatch`: `claimed` gồm task bị bỏ vì run đang bị giữ. */
export type EscalationBatch = { tasks: ClaimedEscalation[]; claimed: number; more: boolean };
export type EscalatedAssigneeRow = { tenantId: string; taskId: string; groupId: string };
export type EscalateAuditRow = {
  tenantId: string;
  taskId: string;
  action: "escalate" | "escalate_skipped";
  entityName: string;
  fromGroupId: string | null;
  toGroupId: string;
};
export type ReviewTaskBatchRepo = {
  /** MỘT câu: khoá task mở tới hạn nhắc (SKIP LOCKED), trả kèm tên + người nhận (mọi Group assignee). */
  claimDueReminders(limit: number, now: Date): Promise<ReminderBatch>;
  /** MỘT câu: `reminded_at = now` + mốc kế theo hàng (`jsonb_to_recordset`, khớp `(id, tenant_id)`). */
  markRemindedMany(rows: readonly ReminderMark[], now: Date): Promise<void>;
  /** MỘT câu claim-update: khoá task tới hạn chuyển cấp (SKIP LOCKED), đặt `escalated_at`. */
  claimDueEscalations(limit: number, now: Date): Promise<EscalationBatch>;
  /** MỘT câu nhiều hàng: assignee Group `via='escalated'` (Group cùng tenant hàng nguồn). */
  addEscalatedGroups(rows: readonly EscalatedAssigneeRow[]): Promise<void>;
  /** MỘT câu nhiều hàng: audit `escalate` / `escalate_skipped`. */
  auditEscalations(rows: readonly EscalateAuditRow[]): Promise<void>;
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
  /** MỘT câu (như `insertMany`) + sự kiện `process.notice` vào outbox (phát SAU COMMIT); trả số notice chèn thật. */
  notifyMany(kind: NoticeKind, rows: readonly NoticeMetaRow[]): Promise<number>;
};
/** Hàng notice kèm tên quy trình/bước cho sự kiện `process.notice`. */
export type NoticeMetaRow = NoticeRow & {
  processName: string;
  stageName: string | null;
  /** P-d2 · D2-47 · chỉ notice `escalated`. */
  group?: { id: string; name: string };
  afterH?: number;
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

/**
 * T6c · cổng cho đường request (route, use case HTTP): CHỈ scope user (RLS). Route/use case HTTP không bao giờ nhận
 * `SystemUow` (test `uow-boundary.test.ts`). `tenantId` không phải uuid ⇒ `DomainError("TENANT_INVALID")` trước khi mở tx.
 */
export type TenantUow = {
  /** Request người dùng: `withHubScope({kind:"user", tenantId, userId})` (RLS) + repo lọc `tenantId`. */
  tenant<T>(who: { tenantId: string; userId: string }, fn: (r: TxRepos) => Promise<T>): Promise<T>;
};
/** T6c · cổng CHỈ cho vòng nền + handles (`ProcessBgDeps.sysUow`): scope `system` bỏ qua RLS. */
export type SystemUow = {
  /** Vòng nền theo hàng: scope `system`; repo gắn `tenantId`, MỌI câu lọc `tenant_id` tường minh (CA-R06). */
  system<T>(tenantId: string, fn: (r: TxRepos) => Promise<T>): Promise<T>;
  /** CHỈ vòng nền theo tập (nhắc, chuyển cấp, hết hạn — CR-093, A11): một tx scope `system` mỗi lô. */
  systemBatch<T>(fn: (r: BatchRepos) => Promise<T>): Promise<T>;
};
/** Adapter `createHubUow` dựng đủ cả hai; mount tách thành hai object riêng (`tenantOnly`/`systemOnly`). */
export type UnitOfWork = TenantUow & SystemUow;
