// HUB-FR-104…117 · CR-056 · hằng + enum Process Engine P-a (plan-contract §1). Chỉ thêm; QC import đúng tên.
// Thực thể ở `processes-entities.ts`, request/response ở `processes-api.ts` (tách để mỗi file ≤ 400 dòng).
import { z } from "zod";

export const PROCESS_KEY_RE = /^[a-z0-9-]{2,32}$/;
export const PROCESS_NAME_MAX = 80;
export const PROCESS_DESC_MAX = 500;
export const PROCESS_INPUT_MAX = 8_000;
export const PROCESS_STAGES_MAX = 10;
export const PROCESS_RUN_GROUPS_MAX = 20;
export const PROCESS_OUTPUT_MAX = 200_000;
export const FEEDBACK_MAX = 4_000;
export const ANSWER_MAX = 4_000;
export const FORWARD_NOTE_MAX = 500;
export const FORWARD_CHAIN_MAX = 3;
export const REDO_MAX = 3;
export const ASKS_MAX = 3;
export const PROCESS_RUNS_PER_TENANT = 5;
export const PROCESS_RUN_TTL_DAYS = 7;
export const REMIND_AFTER_H = 24;
export const TOO_MANY_PROCESS_RUNS_RETRY_AFTER_S = 30;
export const PROCESS_SUGGESTIONS_MAX = 3;
export const STAGE_TIMEOUT_S = { min: 60, default: 600, max: 3600 } as const;
export const HISTORY_MAX = 200;
export const PROCESS_LIST_LIMIT = { default: 50, max: 200 } as const;
export const TEAM_LIMITS_DEFAULT = {
  max_calls: 10,
  max_tokens: 200_000,
  max_active_s: 600,
  summary_tokens: 200,
  max_plan_steps: 5,
} as const;
/** `open_count = min(số task mở, 100)`; FE hiện "99+" khi = 100. */
export const OPEN_TASKS_COUNT_MAX = 100;
export const PROCESS_RUN_ID_HEADER = "X-Process-Run-Id";
export const PROCESS_SYSTEM_SENDER = {
  key: "process",
  name: { vi: "Quy trình", en: "Processes" },
} as const;

export const PROCESS_RUN_STATUSES = [
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
  "done",
  "cancelled",
  "failed",
  "expired",
] as const;
export const PROCESS_RUN_ACTIVE = [
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
] as const;
export const STAGE_RUN_STATUSES = [
  "pending",
  "queued",
  "running",
  "waiting_answer",
  "waiting_review",
  "needs_decision",
  "done",
  "cancelled",
  "failed",
] as const;
/** Mặc định `sequential` (spike, U3). */
export const TEAM_MODES = ["sequential", "lead_plan", "parallel_merge"] as const;
export const TEAM_RUN_STATUSES = [
  "running",
  "waiting_answer",
  "done",
  "limit",
  "failed",
  "cancelled",
] as const;
export const TASK_KINDS = ["review", "ask", "decision"] as const;
export const TASK_STATUSES = ["open", "closed"] as const;
export const TASK_RESULTS = [
  "pass",
  "fail",
  "answer",
  "add_attempt",
  "use_current",
  "cancel",
  "cancelled",
  "expired",
  "superseded",
] as const;
export const DECISION_REASONS = [
  "redo_limit",
  "ask_limit",
  "template_invalid",
  "team_calls",
  "team_tokens",
  "team_time",
  "team_no_change",
  "job_timeout",
  "stage_tokens",
  "run_tokens",
  "agent_failed",
  "permission_lost",
  "user_inactive",
  "interrupted",
  "source_unresolvable",
  "back_limit",
] as const;
export const DECISION_OPTIONS = ["add_attempt", "use_current", "cancel"] as const;
export const NOTICE_KINDS = [
  "review_requested",
  "ask_requested",
  "decision_requested",
  "reminder",
  "task_closed",
  "run_finished",
] as const;
export const ORIGIN_KINDS = ["room", "conversation", "admin"] as const;
export const STAGE_AFTER_KINDS = ["review", "auto"] as const;
export const EXECUTOR_KINDS = ["agent", "team"] as const;
export const STEP_ROLES = ["agent", "plan", "member"] as const;

export type ProcessRunStatus = (typeof PROCESS_RUN_STATUSES)[number];
export type StageRunStatus = (typeof STAGE_RUN_STATUSES)[number];
export type TeamMode = (typeof TEAM_MODES)[number];
export type TeamRunStatus = (typeof TEAM_RUN_STATUSES)[number];
export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskResult = (typeof TASK_RESULTS)[number];
export type DecisionReason = (typeof DECISION_REASONS)[number];
export type DecisionOption = (typeof DECISION_OPTIONS)[number];
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export type OriginKind = (typeof ORIGIN_KINDS)[number];
export type StepRole = (typeof STEP_ROLES)[number];

export const ProcessKeySchema = z.string().regex(PROCESS_KEY_RE);
export const ProcessRunStatusSchema = z.enum(PROCESS_RUN_STATUSES);
export const StageRunStatusSchema = z.enum(STAGE_RUN_STATUSES);
export const TeamModeSchema = z.enum(TEAM_MODES);
export const TeamRunStatusSchema = z.enum(TEAM_RUN_STATUSES);
export const TaskKindSchema = z.enum(TASK_KINDS);
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export const TaskResultSchema = z.enum(TASK_RESULTS);
export const DecisionReasonSchema = z.enum(DECISION_REASONS);
export const DecisionOptionSchema = z.enum(DECISION_OPTIONS);
export const NoticeKindSchema = z.enum(NOTICE_KINDS);
export const OriginKindSchema = z.enum(ORIGIN_KINDS);
export const StageAfterSchema = z.enum(STAGE_AFTER_KINDS);
export const StepRoleSchema = z.enum(STEP_ROLES);
/** Trong một run: 0..PROCESS_STAGES_MAX-1. */
export const StageIdxSchema = z
  .number()
  .int()
  .min(0)
  .max(PROCESS_STAGES_MAX - 1);

// ── P-b2 · bước song song + quay lại + Bàn giao [HUB-FR-104][HUB-FR-118][HUB-FR-136] (plan P-b2 §1.1) ─────────────
/** Bước 0-based (UI đếm từ 1 — G-4). */
export const PROCESS_STEP_MAX = PROCESS_STAGES_MAX - 1;
export const PROCESS_STEP_STAGES_MAX = 3;
/** Trần quay lại mặc định của run (`process_runs.back_limit`). */
export const PROCESS_BACK_ROUNDS_MAX = 3;
export const BACK_EVENTS_MAX = 20;
export const HANDOFF_SECTION = "Bàn giao";
export const HANDOFF_TOKENS_MAX = 200;
export const HANDOFF_CHARS_PER_TOKEN = 4;
export const ProcessStepSchema = z.number().int().min(0).max(PROCESS_STEP_MAX);
export type ProcessStep = z.infer<typeof ProcessStepSchema>;
