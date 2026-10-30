// HUB-FR-104 · HUB-FR-106 · HUB-FR-113 · HUB-BR-25 · kiểu Drizzle cho bảng quy trình P-a (plan §2.1, plan-thread §3).
// CHỈ để truy vấn có kiểu: DDL thật, CHECK, FK kép tenant, RLS, GRANT và hàm SECURITY DEFINER (`is_process_trigger`,
// `process_run_viewer`, `room_post_process_message`) ở `migrations-hub/0019_pa_process_engine.sql` (viết tay); P-b2 ở `0024`.
// Người nhận `process.updated`: hàm SECURITY DEFINER `process_run_recipients` ở `0020_pa_process_recipients.sql`.
// Enum lấy từ `@ai/contracts/chat` (một nguồn); đổi giá trị ⇒ cần migration mới sửa CHECK tương ứng.
import {
  DECISION_REASONS,
  NOTICE_KINDS,
  ORIGIN_KINDS,
  PROCESS_RUN_STATUSES,
  ROOM_PROCESS_KINDS,
  STAGE_RUN_STATUSES,
  TASK_KINDS,
  TASK_RESULTS,
  TASK_STATUSES,
  TEAM_MODES,
  TEAM_RUN_STATUSES,
  TIMER_KINDS,
} from "@ai/contracts/chat";
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { LIB_AUDIT_ACTIONS } from "./hub-process-library";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();
const tenantId = () => uuid("tenant_id").notNull();

export const TEAM_STOP_REASON_VALUES = [
  "calls",
  "tokens",
  "time",
  "no_change",
  "member_failed",
  "cancelled",
] as const;
/** P-d1 (0036) + `escalated` (PD-R20). */
export const ASSIGNEE_VIA_VALUES = ["initial", "forward", "escalated"] as const;
export const THREAD_EVENT_OUTCOME_VALUES = ["posted", "skipped"] as const;
export const THREAD_PLACEMENT_VALUES = ["main", "flow"] as const;
/** audit P-a (0019 `hub_audit_log_action_check`/`_entity_check`) — trải vào `HUB_AUDIT_*_VALUES` (hub.ts). */
export const PA_AUDIT_ACTIONS = [
  "start",
  "cancel",
  "decide",
  "review",
  "answer",
  "forward",
  "view",
  "copy",
  "authorize_real_action",
] as const;
/** audit P-d1 (0036 `hub_audit_log_action_check`) — trải vào `HUB_AUDIT_ACTION_VALUES` (hub.ts). P-d2 (0037) + `tool_call`, `branch`. */
export const PD_AUDIT_ACTIONS = [
  "escalate",
  "escalate_skipped",
  "tool_call",
  "branch",
  ...LIB_AUDIT_ACTIONS, // CR-105 · L2a (0069) — gộp ở đây vì `hub.ts` chạm trần 400 dòng
] as const;
export const PA_AUDIT_ENTITIES = [
  "process_def",
  "process_run",
  "review_task",
  "agent_team",
] as const;

/** Cột 0019 trên `hub.runs` (run stage): CHECK `runs_process_ck` (process_run_id NULL) = (stage_run_id NULL). */
export const processRunCols = () => ({
  processRunId: uuid("process_run_id"),
  stageRunId: uuid("stage_run_id"),
  teamRunId: uuid("team_run_id"),
});

// ── Nhóm agent (cấu hình, không RLS; hub_rw chỉ SELECT) ──
export const agentTeams = hub.table("agent_teams", {
  id: id(),
  key: text("key").notNull(),
  name: jsonb("name").$type<{ vi: string; en: string }>().notNull(),
  description: text("description").notNull().default(""),
  mode: text("mode", { enum: TEAM_MODES }).notNull().default("sequential"),
  leadAgentId: uuid("lead_agent_id"),
  limits: jsonb("limits").$type<Record<string, number>>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const agentTeamMembers = hub.table(
  "agent_team_members",
  {
    teamId: uuid("team_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    role: text("role").notNull(),
    sections: text("sections").array().notNull().default(sql`'{}'`),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.agentId] })],
);

export const agentTeamEntitlements = hub.table(
  "agent_team_entitlements",
  {
    teamId: uuid("team_id").notNull(),
    tenantId: tenantId(),
    grantedBy: uuid("granted_by"),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.tenantId] })],
);

// ── Định nghĩa (null tenant = mẫu platform_admin; ghi chỉ scope system — D17) ──
export const processDefs = hub.table("process_defs", {
  id: id(),
  tenantId: uuid("tenant_id"),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  inputHint: text("input_hint").notNull().default(""),
  runGroupIds: uuid("run_group_ids").array().notNull().default(sql`'{}'`),
  /** Mảng 1..10 `ProcessStageDef` (zod ở biên). */
  stages: jsonb("stages").$type<unknown[]>().notNull(),
  tokenBudget: integer("token_budget"),
  enabled: boolean("enabled").notNull().default(false),
  sourceTemplateId: uuid("source_template_id"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
  /** P-d1 (0036) · 1..365 ngày; NULL = run không hết hạn (PD-R24). */
  ttlDays: smallint("ttl_days").default(7),
  /** contract-flow S1a (0058) · version def gói đã đồng bộ (`PackRunsPort.ensureDef`); NULL = def thường. */
  packVersion: integer("pack_version"),
  /** CR-105 (0068) · khe app của def thư viện (`tenant_id NULL`); NULL = def thường / mẫu chạy thử. */
  slot: text("slot"),
  /** CR-105 · dạng Form của khe (vd `contracts.approval` = `Flow` của gói, Group theo MÃ). */
  slotBody: jsonb("slot_body").$type<Record<string, unknown>>(),
  /** CR-105 · bản xuất bản đang chạy (`process_def_releases.rel_version`); NULL = chưa xuất bản. */
  publishedVersion: integer("published_version"),
  /** CR-105 · def tenant vật chất hoá từ thư viện: sha256 (16 hex) của def đã biên dịch; NULL = không vật chất hoá. */
  sourceRef: text("source_ref"),
});
// CR-105 · bảng thư viện quy trình (releases, khe, gán) ở `hub-process-library.ts`.

// ── Run (RLS T; không DELETE) ──
export const processRuns = hub.table("process_runs", {
  id: id(),
  tenantId: tenantId(),
  processDefId: uuid("process_def_id").notNull(),
  defVersion: integer("def_version").notNull(),
  /** `{key, name, stages, token_budget, run_group_ids}` lúc bắt đầu. */
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  startedBy: uuid("started_by").notNull(),
  originKind: text("origin_kind", { enum: ORIGIN_KINDS }).notNull(),
  originRoomId: uuid("origin_room_id"),
  originConversationId: uuid("origin_conversation_id"),
  triggerMessageId: uuid("trigger_message_id"),
  input: text("input").notNull(),
  /** Hội thoại nền ẩn (`conversations.process_run_id`). */
  conversationId: uuid("conversation_id").notNull(),
  /** = thread phòng (plan-thread T2), unique. */
  flowId: uuid("flow_id").notNull(),
  status: text("status", { enum: PROCESS_RUN_STATUSES }).notNull().default("running"),
  currentStageIdx: smallint("current_stage_idx").notNull().default(0),
  /** P-b2 (0024) · bước hiện tại — nguồn thật; `current_stage_idx` = stage nhỏ nhất của bước. */
  currentStep: smallint("current_step").notNull().default(0),
  backRounds: smallint("back_rounds").notNull().default(0),
  backLimit: smallint("back_limit").notNull().default(3),
  decision: jsonb("decision").$type<Record<string, unknown>>(),
  tokensTotal: integer("tokens_total").notNull().default(0),
  /** P-d1 (0036) · NULL khi def `ttl_days` NULL. */
  expiresAt: ts("expires_at"),
  cancelledBy: uuid("cancelled_by"),
  startedAt: ts("started_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  /** contract-flow S1a (0058) · bản ghi gói của run (CHỈ `PackRunsPort.start` ghi; đã gắn thì không đổi). */
  packKey: text("pack_key"),
  packRecordId: uuid("pack_record_id"),
  /** CR-105 (0068) · lượt chạy thử từ "Mẫu · chạy thử" (danh sách lượt mặc định lọc `false`). */
  isTest: boolean("is_test").notNull().default(false),
});

export const stageRuns = hub.table("stage_runs", {
  id: id(),
  tenantId: tenantId(),
  processRunId: uuid("process_run_id").notNull(),
  stageIdx: smallint("stage_idx").notNull(),
  status: text("status", { enum: STAGE_RUN_STATUSES }).notNull().default("pending"),
  attempt: smallint("attempt").notNull().default(1),
  attemptLimit: smallint("attempt_limit").notNull().default(4),
  asksCount: smallint("asks_count").notNull().default(0),
  askLimit: smallint("ask_limit").notNull().default(3),
  templateFailures: smallint("template_failures").notNull().default(0),
  currentRunId: uuid("current_run_id"),
  currentOutputId: uuid("current_output_id"),
  feedback: text("feedback"),
  redoSections: text("redo_sections").array(),
  passedBy: uuid("passed_by"),
  passedAt: ts("passed_at"),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  /** P-b2 (0024) · vòng (+1 khi bị quay lại và đã từng chạy). */
  round: smallint("round").notNull().default(1),
  /** P-b2 · đích quay lại đang chờ quyết (`needs_decision(back_limit)`). */
  backToStep: smallint("back_to_step"),
  /** P-d1 (0036) · số lần thử lại 0..3; chỉ hiệu lực khi `retryAttempt`/`retryRound` = `attempt`/`round` (plan §4.2). */
  retryCount: smallint("retry_count").notNull().default(0),
  retryAttempt: smallint("retry_attempt"),
  retryRound: smallint("retry_round"),
  /** PD-R05 · mốc cửa sổ "đã gửi side_effect". */
  retrySince: ts("retry_since"),
  /** ≤ 64 ký tự (CHECK). */
  lastErrorCode: text("last_error_code"),
});

export const teamRuns = hub.table("team_runs", {
  id: id(),
  tenantId: tenantId(),
  stageRunId: uuid("stage_run_id").notNull(),
  processRunId: uuid("process_run_id").notNull(),
  attempt: smallint("attempt").notNull(),
  teamId: uuid("team_id").notNull(),
  mode: text("mode", { enum: TEAM_MODES }).notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>(),
  cursor: smallint("cursor").notNull().default(0),
  status: text("status", { enum: TEAM_RUN_STATUSES }).notNull().default("running"),
  stopReason: text("stop_reason", { enum: TEAM_STOP_REASON_VALUES }),
  calls: smallint("calls").notNull().default(0),
  tokens: integer("tokens").notNull().default(0),
  activeMs: integer("active_ms").notNull().default(0),
  segmentStartedAt: ts("segment_started_at"),
  lastHash: text("last_hash"),
  sameCount: smallint("same_count").notNull().default(0),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const processOutputs = hub.table("process_outputs", {
  id: id(),
  tenantId: tenantId(),
  processRunId: uuid("process_run_id").notNull(),
  stageRunId: uuid("stage_run_id").notNull(),
  stageIdx: smallint("stage_idx").notNull(),
  version: smallint("version").notNull(),
  attempt: smallint("attempt").notNull(),
  content: text("content").notNull(),
  sections: jsonb("sections").$type<Record<string, string>>(),
  fields: jsonb("fields").$type<Record<string, unknown>>(),
  summaries: jsonb("summaries").$type<Record<string, string>>(),
  templateOk: boolean("template_ok").notNull(),
  templateMissing: text("template_missing").array().notNull().default(sql`'{}'`),
  attachmentId: uuid("attachment_id"),
  createdAt: createdAt(),
  /** P-b2 (0024) · = `stage_runs.round` lúc ghi. */
  round: smallint("round").notNull().default(1),
});

export const reviewTasks = hub.table("review_tasks", {
  id: id(),
  tenantId: tenantId(),
  processRunId: uuid("process_run_id").notNull(),
  stageRunId: uuid("stage_run_id").notNull(),
  kind: text("kind", { enum: TASK_KINDS }).notNull(),
  status: text("status", { enum: TASK_STATUSES }).notNull().default("open"),
  outputId: uuid("output_id"),
  question: text("question"),
  choices: jsonb("choices").$type<string[]>(),
  excerpt: text("excerpt"),
  reason: text("reason", { enum: DECISION_REASONS }),
  assigneeGroupId: uuid("assignee_group_id"),
  remindAt: ts("remind_at").notNull(),
  remindedAt: ts("reminded_at"),
  result: text("result", { enum: TASK_RESULTS }),
  feedback: text("feedback"),
  answer: text("answer"),
  sections: text("sections").array(),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  createdAt: createdAt(),
  /** P-d1 (0036) · nhắc lặp + chuyển cấp, chép từ snapshot lúc tạo task review (PD-R19); chỉ `kind = review` (CHECK). */
  remindCount: smallint("remind_count").notNull().default(0),
  /** 4..168 giờ; NULL = không nhắc lặp. */
  remindEveryH: smallint("remind_every_h"),
  /** NULL ⇔ `escalateGroupId` NULL (CHECK). */
  escalateAt: ts("escalate_at"),
  /** admin.groups — không FK chéo schema; kiểm cùng tenant ở luật (S2). */
  escalateGroupId: uuid("escalate_group_id"),
  escalatedAt: ts("escalated_at"),
});

/** Grant xem/làm task: đúng một trong `userId`/`groupId` (CHECK). */
export const reviewTaskAssignees = hub.table("review_task_assignees", {
  id: id(),
  tenantId: tenantId(),
  taskId: uuid("task_id").notNull(),
  userId: uuid("user_id"),
  groupId: uuid("group_id"),
  via: text("via", { enum: ASSIGNEE_VIA_VALUES }).notNull().default("initial"),
  fromUserId: uuid("from_user_id"),
  note: text("note"),
  depth: smallint("depth").notNull().default(0),
  firstViewedAt: ts("first_viewed_at"),
  createdAt: createdAt(),
});

/** DM "Quy trình" (D12): đọc/sửa chỉ của mình (RLS); INSERT theo tenant. */
export const processNotices = hub.table("process_notices", {
  id: id(),
  tenantId: tenantId(),
  userId: uuid("user_id").notNull(),
  kind: text("kind", { enum: NOTICE_KINDS }).notNull(),
  processRunId: uuid("process_run_id").notNull(),
  taskId: uuid("task_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  readAt: ts("read_at"),
});

/** Outbox tin thread (plan-thread T5): INSERT theo tenant; SELECT/UPDATE chỉ scope system. */
export const processThreadEvents = hub.table("process_thread_events", {
  id: id(),
  tenantId: tenantId(),
  processRunId: uuid("process_run_id").notNull(),
  roomId: uuid("room_id").notNull(),
  kind: text("kind", { enum: ROOM_PROCESS_KINDS }).notNull(),
  /** `block` ⇔ `main` (CHECK). */
  placement: text("placement", { enum: THREAD_PLACEMENT_VALUES }).notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull(),
  /** 1..500 ký tự. */
  content: text("content").notNull(),
  createdAt: createdAt(),
  postedAt: ts("posted_at"),
  outcome: text("outcome", { enum: THREAD_EVENT_OUTCOME_VALUES }),
});

/** P-b2 (0024) · nhật ký quay lại — append-only (hub_rw chỉ SELECT/INSERT), RLS tenant; FK run CASCADE, task SET NULL. */
export const processBackEvents = hub.table("process_back_events", {
  id: id(),
  tenantId: tenantId(),
  processRunId: uuid("process_run_id").notNull(),
  taskId: uuid("task_id"),
  fromStageIdx: smallint("from_stage_idx").notNull(),
  fromStep: smallint("from_step").notNull(),
  toStep: smallint("to_step").notNull(),
  /** Vòng của bước đích sau khi quay lại (≥ 2). */
  roundAfter: smallint("round_after").notNull(),
  feedback: text("feedback").notNull(),
  decidedBy: uuid("decided_by").notNull(),
  createdAt: createdAt(),
});

/** P-d1 (0036) · hẹn giờ bền (`wait_until` | `retry`): RLS T (ENABLE không FORCE), FK kép `(…, tenant_id)` tới run/stage
 * CASCADE; hub_rw SELECT/INSERT/UPDATE (không DELETE — huỷ = `cancelledAt`). `timezone` khác NULL ⇔ `kind = wait_until`. */
export const processTimers = hub.table("process_timers", {
  id: id(),
  tenantId: tenantId(),
  processRunId: uuid("process_run_id").notNull(),
  stageRunId: uuid("stage_run_id").notNull(),
  kind: text("kind", { enum: TIMER_KINDS }).notNull(),
  dueAt: ts("due_at").notNull(),
  /** IANA đọc lúc lưu hẹn (TZ-R04), ≤ 64 ký tự. */
  timezone: text("timezone"),
  firedAt: ts("fired_at"),
  cancelledAt: ts("cancelled_at"),
  /** UNIQUE, 1..200 ký tự. */
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: createdAt(),
});
