// HUB-FR-105…117 · HUB-BR-25 · CR-056 · thực thể dùng chung P-a (plan-contract §2). Mọi object strict; không I/O.
import { z } from "zod";
import { DISPLAY_NAME_MAX, IsoDateTime, UuidSchema } from "../common";
import { StageKnowledgeSchema } from "../hub-admin/kh";
import { CHAT_ASK_CHOICE_MAX, CHAT_ASK_CHOICES_MAX, CHAT_ASK_QUESTION_MAX } from "./entities";
import {
  BACK_EVENTS_MAX,
  DecisionOptionSchema,
  DecisionReasonSchema,
  EXECUTOR_KINDS,
  FEEDBACK_MAX,
  FORWARD_CHAIN_MAX,
  FORWARD_NOTE_MAX,
  HISTORY_MAX,
  NoticeKindSchema,
  OriginKindSchema,
  PROCESS_INPUT_MAX,
  PROCESS_NAME_MAX,
  PROCESS_OUTPUT_MAX,
  PROCESS_STAGES_MAX,
  PROCESS_STEP_MAX,
  ProcessKeySchema,
  ProcessRunStatusSchema,
  ProcessStepSchema,
  REMIND_MAX,
  STAGE_RETRY_MAX,
  StageAfterSchema,
  StageIdxSchema,
  StageKeySchema,
  StageRunStatusSchema,
  StepRoleSchema,
  TaskKindSchema,
  TaskResultSchema,
  TaskStatusSchema,
  TeamModeSchema,
  TeamRunStatusSchema,
} from "./processes";
import { ApplyStageViewSchema, AutofixStageViewSchema } from "./processes-autofix";

/** Trần mảng con (plan-contract §2). */
export const TEMPLATE_MISSING_MAX = 20;
export const STAGE_OUTPUTS_MAX = 20;
export const MY_TASKS_MAX = 20;
export const OPEN_TASKS_MAX = 10;
export const TASK_ASSIGNEES_MAX = 20;
export const TASK_VIEW_OUTPUTS_MAX = 50;
export const TASK_EXCERPT_MAX = 1_000;
export const USAGE_TEAM_CALLS_MAX = 10;
export const USAGE_STAGE_CALLS_MAX = 50;
export const PROCESS_SECTIONS_MAX = 20;

const Int0 = z.number().int().min(0);
const Int1 = z.number().int().min(1);
const NameSchema = z.string().min(1).max(PROCESS_NAME_MAX);
const AgentNameSchema = z.string().min(1).max(100);
/** `{id, name}` của Group (giữ đúng hình cũ của `OpenTask.group`). */
const GroupRefSchema = z.strictObject({ id: UuidSchema, name: z.string().min(1).max(100) });

export const UserRefSchema = z.strictObject({
  id: UuidSchema,
  display_name: z.string().min(1).max(DISPLAY_NAME_MAX),
});
export type UserRef = z.infer<typeof UserRefSchema>;

export const ExecutorRefSchema = z.strictObject({
  kind: z.enum(EXECUTOR_KINDS),
  key: z.string().min(1).max(64),
  name: z.strictObject({ vi: AgentNameSchema, en: AgentNameSchema }),
});
export type ExecutorRef = z.infer<typeof ExecutorRefSchema>;

/** Tên snapshot của agent ở một bước (meta tin `output`, usage). */
export const StepAgentRefSchema = z.strictObject({
  key: z.string().min(1).max(64),
  name: AgentNameSchema,
});
export type StepAgentRef = z.infer<typeof StepAgentRefSchema>;

export const ProcessRefSchema = z.strictObject({ key: ProcessKeySchema, name: NameSchema });
export type ProcessRef = z.infer<typeof ProcessRefSchema>;

export const OutputRefSchema = z.strictObject({
  id: UuidSchema,
  version: Int1,
  attempt: Int1,
  template_ok: z.boolean(),
  template_missing: z.array(z.string().min(1)).max(TEMPLATE_MISSING_MAX),
  created_at: IsoDateTime,
  /** P-b2 · vòng (sau quay lại); vắng ở meta thread cũ ⇒ 1. */
  round: Int1.optional(),
  /** P-b2 · Bàn giao > 200 token đã bị cắt khi chuyển cho bước sau (cờ thôi). */
  handoff_truncated: z.boolean().optional(),
});
export type OutputRef = z.infer<typeof OutputRefSchema>;

export const ProcessOriginSchema = z.strictObject({
  kind: OriginKindSchema,
  room_id: UuidSchema.optional(),
  conversation_id: UuidSchema.optional(),
});

export const ProcessRunSummarySchema = z.strictObject({
  id: UuidSchema,
  process: z.strictObject({ key: ProcessKeySchema, name: NameSchema, version: Int1 }),
  status: ProcessRunStatusSchema,
  current_stage_idx: StageIdxSchema,
  stage_count: z.number().int().min(1).max(PROCESS_STAGES_MAX),
  started_by: UserRefSchema,
  origin: ProcessOriginSchema,
  started_at: IsoDateTime,
  updated_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
  decision_reason: DecisionReasonSchema.optional(),
  /** P-b2 · bước hiện tại (nguồn thật; `current_stage_idx` = stage nhỏ nhất của bước). */
  current_step: ProcessStepSchema,
  step_count: z.number().int().min(1).max(PROCESS_STAGES_MAX),
  /** P-d1 · PD-R25 · `null` = không hết hạn; Hub luôn đặt (optional chỉ để mock FE cũ không vỡ — A4 G6). */
  expires_at: IsoDateTime.nullable().optional(),
  /** P-d2 · D2-45 · `due_at` sớm nhất của hẹn `wait_until` / `retry` còn mở của run; không có ⇒ `null` (Hub: T17b). */
  wait_until: IsoDateTime.nullable().optional(),
  retry_at: IsoDateTime.nullable().optional(),
});
export type ProcessRunSummary = z.infer<typeof ProcessRunSummarySchema>;

export const StageViewSchema = z.strictObject({
  idx: StageIdxSchema,
  key: StageKeySchema,
  name: NameSchema,
  executor: ExecutorRefSchema,
  after: StageAfterSchema,
  real_action: z.boolean(),
  status: StageRunStatusSchema,
  attempt: Int0,
  attempt_limit: Int1,
  asks_count: Int0,
  ask_limit: Int0,
  outputs: z.array(OutputRefSchema).max(STAGE_OUTPUTS_MAX),
  current_output_id: UuidSchema.nullable(),
  passed_by: UserRefSchema.nullable(),
  passed_at: IsoDateTime.nullable(),
  step: ProcessStepSchema,
  round: Int1,
  /** Bước được phép quay lại khi Chưa đạt (`[]` khi auto / không cấu hình). */
  back_to_steps: z.array(ProcessStepSchema).max(PROCESS_STEP_MAX),
  /** K1 · KnowledgeHub của stage (spec K1 §3.1); vắng ⇒ stage không dùng KH. */
  knowledge: StageKnowledgeSchema.optional(),
  /** P-c1 · chỉ khi stage có cấu hình `autofix` VÀ đã có kết quả. */
  autofix: AutofixStageViewSchema.optional(),
  /** P-c2 · chỉ stage Áp (executor `apply`) đã có hàng `autofix_applies`. */
  apply: ApplyStageViewSchema.optional(),
  /** P-d1 · số lần thử lại HIỆU LỰC 0…3 (Hub luôn trả — A4 G5); optional cho mock FE cũ. */
  retry_count: z.number().int().min(0).max(STAGE_RETRY_MAX).optional(),
  /** P-d1 · hẹn `retry` chưa bắn; loại trừ với `wait`. */
  next_retry_at: IsoDateTime.optional(),
  /** P-d1 · mã lỗi lần gần nhất, chỉ khi `retry_count > 0`. */
  last_error_code: z.string().min(1).max(64).optional(),
  /** P-d1 · hẹn `wait_until` chưa huỷ + múi giờ lúc lưu hẹn. */
  wait: z.strictObject({ due_at: IsoDateTime, timezone: z.string().min(1).max(64) }).optional(),
  /** P-d2 · chỉ stage `tool`: key tool trong catalog. */
  tool_key: ProcessKeySchema.optional(),
});
export type StageView = z.infer<typeof StageViewSchema>;

export const HistoryItemSchema = z.strictObject({
  at: IsoDateTime,
  // P-d1 thêm `escalate` (cuối).
  kind: z.enum(["review", "ask", "decision", "forward", "cancel", "expire", "escalate"]),
  task_id: UuidSchema.nullable(),
  stage_idx: StageIdxSchema,
  actor: UserRefSchema.nullable(),
  result: TaskResultSchema.optional(),
  feedback: z.string().max(FEEDBACK_MAX).optional(),
  question: z.string().max(CHAT_ASK_QUESTION_MAX).optional(),
  answer: z.string().max(FEEDBACK_MAX).optional(),
  note: z.string().max(FORWARD_NOTE_MAX).optional(),
  to: UserRefSchema.optional(),
  /** P-b2 · review `fail` có quay lại. */
  to_step: ProcessStepSchema.optional(),
  /** P-d1 · chỉ `escalate`: Group nhận chuyển cấp. */
  group: GroupRefSchema.optional(),
  /** P-d2 · D2-47 · chỉ `escalate`: số giờ chờ trước khi chuyển cấp (`after.escalate.after_h` của snapshot). */
  after_h: Int1.optional(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export const TaskForwardSchema = z.strictObject({
  from: UserRefSchema,
  to: UserRefSchema,
  note: z.string().max(FORWARD_NOTE_MAX).nullable(),
  at: IsoDateTime,
});
export type TaskForward = z.infer<typeof TaskForwardSchema>;

export const TaskDetailSchema = z.strictObject({
  id: UuidSchema,
  kind: TaskKindSchema,
  status: TaskStatusSchema,
  stage_idx: StageIdxSchema,
  stage_name: NameSchema,
  output: OutputRefSchema.optional(),
  question: z.string().min(1).max(CHAT_ASK_QUESTION_MAX).optional(),
  choices: z.array(z.string().min(1).max(CHAT_ASK_CHOICE_MAX)).max(CHAT_ASK_CHOICES_MAX).optional(),
  excerpt: z.string().max(TASK_EXCERPT_MAX).optional(),
  reason: DecisionReasonSchema.optional(),
  /** decision: = `decision.options` (lọc `use_current` khi chưa có output). */
  options: z.array(DecisionOptionSchema).max(3).optional(),
  has_output: z.boolean().optional(),
  forwards: z.array(TaskForwardSchema).max(FORWARD_CHAIN_MAX),
  result: TaskResultSchema.optional(),
  can_act: z.boolean(),
  created_at: IsoDateTime,
  /** P-b2 · chỉ review MỞ của stage có `back_to_steps` ≠ []. */
  back_steps: z.array(ProcessStepSchema).max(PROCESS_STEP_MAX).optional(),
  back_rounds_left: Int0.optional(),
  /** P-d1 · chỉ task `review`: đã chuyển cấp / số lần đã nhắc lặp. */
  escalated: z.boolean().optional(),
  remind_count: z.number().int().min(0).max(REMIND_MAX).optional(),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/** WaitingNote: ai đang được chờ (không lộ nội dung task). */
export const OpenTaskSchema = z.strictObject({
  id: UuidSchema,
  kind: TaskKindSchema,
  stage_idx: StageIdxSchema,
  assignees: z.array(UserRefSchema).max(TASK_ASSIGNEES_MAX),
  group: GroupRefSchema.nullable(),
  /** P-d1 · Group chuyển cấp (assignee `via='escalated'`); `null` khi chưa chuyển — chỉ full view (A4 G7). */
  escalated_group: GroupRefSchema.nullable().optional(),
});
export type OpenTask = z.infer<typeof OpenTaskSchema>;

export const RunDecisionSchema = z.strictObject({
  reason: DecisionReasonSchema,
  stage_idx: StageIdxSchema,
  options: z.array(DecisionOptionSchema).max(3),
  can_decide: z.boolean(),
  /** P-b2 · chỉ khi `reason = back_limit`: đích quay lại đang chờ. */
  back_to_step: ProcessStepSchema.optional(),
});

/** P-b2 · một lần quay lại (`hub.process_back_events`). */
export const BackEventSchema = z.strictObject({
  at: IsoDateTime,
  task_id: UuidSchema.nullable(),
  from_stage_idx: StageIdxSchema,
  from_step: ProcessStepSchema,
  to_step: ProcessStepSchema,
  round: z.number().int().min(2),
  feedback: z.string().min(1).max(FEEDBACK_MAX),
  by: UserRefSchema,
});
export type BackEvent = z.infer<typeof BackEventSchema>;

export const ProcessRunFullViewSchema = ProcessRunSummarySchema.extend({
  access: z.literal("full"),
  input: z.string().max(PROCESS_INPUT_MAX),
  stages: z.array(StageViewSchema).max(PROCESS_STAGES_MAX),
  history: z.array(HistoryItemSchema).max(HISTORY_MAX),
  decision: RunDecisionSchema.nullable(),
  my_tasks: z.array(TaskDetailSchema).max(MY_TASKS_MAX),
  open_tasks: z.array(OpenTaskSchema).max(OPEN_TASKS_MAX),
  /** U1: null khi không bắt đầu từ phòng hoặc phòng đã xoá. */
  thread: z.strictObject({ room_id: UuidSchema, flow_id: UuidSchema }).nullable(),
  can_cancel: z.boolean(),
  back_rounds: Int0,
  back_limit: Int0,
  back_events: z.array(BackEventSchema).max(BACK_EVENTS_MAX),
});

/** Người xem ngoài phòng (assignee / người bắt đầu đã rời — U5): không input/history/decision/thread. */
export const ProcessRunTaskViewSchema = z.strictObject({
  access: z.literal("task"),
  id: UuidSchema,
  process: ProcessRefSchema,
  status: ProcessRunStatusSchema,
  stages: z
    .array(
      z.strictObject({
        idx: StageIdxSchema,
        name: NameSchema,
        status: StageRunStatusSchema,
        step: ProcessStepSchema,
        round: Int1,
        /** P-c1 · PC-R14 · chỉ stage có task duyệt của người xem (`my_tasks`) và có kết quả tự-sửa. */
        autofix: AutofixStageViewSchema.optional(),
      }),
    )
    .max(PROCESS_STAGES_MAX),
  my_tasks: z.array(TaskDetailSchema).max(MY_TASKS_MAX),
  outputs: z.array(OutputRefSchema).max(TASK_VIEW_OUTPUTS_MAX).optional(),
  can_cancel: z.boolean().optional(),
});

export const ProcessRunViewSchema = z.discriminatedUnion("access", [
  ProcessRunFullViewSchema,
  ProcessRunTaskViewSchema,
]);
export type ProcessRunView = z.infer<typeof ProcessRunViewSchema>;
export type ProcessRunFullView = z.infer<typeof ProcessRunFullViewSchema>;
export type ProcessRunTaskView = z.infer<typeof ProcessRunTaskViewSchema>;

export const ProcessOutputSchema = z.strictObject({
  id: UuidSchema,
  stage_idx: StageIdxSchema,
  version: Int1,
  attempt: Int1,
  content: z.string().max(PROCESS_OUTPUT_MAX),
  fields: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
  template_ok: z.boolean(),
  template_missing: z.array(z.string().min(1)).max(TEMPLATE_MISSING_MAX),
  created_at: IsoDateTime,
});
export type ProcessOutput = z.infer<typeof ProcessOutputSchema>;

/** `total` = input + output + cache_read + cache_write. */
export const TokenTotalsSchema = z.strictObject({
  input: Int0,
  output: Int0,
  cache_read: Int0,
  cache_write: Int0,
  total: Int0,
  calls: Int0,
});
export type TokenTotals = z.infer<typeof TokenTotalsSchema>;

export const UsageCallSchema = z.strictObject({
  // E-P14 · dòng `usage_logs` không gắn step (cột nullable) ⇒ `null`; FE không parse được `""` (phải là uuid | null).
  step_id: UuidSchema.nullable(),
  role: StepRoleSchema,
  member_key: z.string().min(1).nullable(),
  agent: StepAgentRefSchema,
  model: z.string().min(1).nullable(),
  tokens: TokenTotalsSchema,
  latency_ms: Int0.nullable(),
  at: IsoDateTime,
});
export type UsageCall = z.infer<typeof UsageCallSchema>;

export const UsageTeamRunSchema = z.strictObject({
  id: UuidSchema,
  attempt: Int1,
  mode: TeamModeSchema,
  status: TeamRunStatusSchema,
  stop_reason: z.string().min(1).nullable(),
  active_ms: Int0,
  totals: TokenTotalsSchema,
  calls: z.array(UsageCallSchema).max(USAGE_TEAM_CALLS_MAX),
});

/** `summary` (người xem `task`): `team_runs=[]`, `calls=[]`. */
export const ProcessRunUsageSchema = z.strictObject({
  process_run_id: UuidSchema,
  detail: z.enum(["full", "summary"]),
  totals: TokenTotalsSchema,
  stages: z
    .array(
      z.strictObject({
        stage_idx: StageIdxSchema,
        name: NameSchema,
        totals: TokenTotalsSchema,
        attempts: Int0,
        asks_count: Int0,
        team_runs: z.array(UsageTeamRunSchema),
        calls: z.array(UsageCallSchema).max(USAGE_STAGE_CALLS_MAX),
      }),
    )
    .max(PROCESS_STAGES_MAX),
});
export type ProcessRunUsage = z.infer<typeof ProcessRunUsageSchema>;

/** Không chứa nội dung output/câu hỏi — xem qua task (HUB-BR-25). */
export const ProcessNoticeSchema = z.strictObject({
  id: UuidSchema,
  kind: NoticeKindSchema,
  process_run_id: UuidSchema,
  task_id: UuidSchema.nullable(),
  process_name: NameSchema,
  stage_name: NameSchema.nullable(),
  result: TaskResultSchema.optional(),
  created_at: IsoDateTime,
  read: z.boolean(),
  /** P-d2 · D2-47 · chỉ `escalated`: Group nhận chuyển cấp + số giờ chờ (payload ghi cùng câu chèn notice). */
  group: GroupRefSchema.optional(),
  after_h: Int1.optional(),
});
export type ProcessNotice = z.infer<typeof ProcessNoticeSchema>;
