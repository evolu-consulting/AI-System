// CR-121 · R-2 · trang chi tiết lượt chạy (admin): header + danh sách bước + dòng thời gian, và nhật ký MỘT bước theo mức
// (basic cho tenant admin, debug chỉ platform_admin — mức do SERVICE quyết theo vai, không theo tham số client).
// Mọi object strict; không I/O. Câu chữ dễ hiểu luôn dạng `{vi, en}` (i18n); mã lỗi/thông điệp gốc/payload chỉ ở `debug`.
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";
import {
  DecisionReasonSchema,
  OriginKindSchema,
  ProcessKeySchema,
  ProcessRunStatusSchema,
  StageRunStatusSchema,
  TaskKindSchema,
  TaskResultSchema,
  TaskStatusSchema,
} from "./processes";

export const RUN_DETAIL_STEPS_MAX = 50;
export const RUN_DETAIL_TIMELINE_MAX = 200;
export const RUN_LOG_TASKS_MAX = 20;
export const RUN_LOG_OUTPUTS_MAX = 20;
export const RUN_LOG_RUNS_MAX = 20;
export const RUN_LOG_OUTPUT_CONTENT_MAX = 4_000;

const Int0 = z.number().int().min(0);
/** Câu chữ hai ngôn ngữ (client chọn theo locale). */
export const I18nTextSchema = z.strictObject({
  vi: z.string().min(1).max(500),
  en: z.string().min(1).max(500),
});
export type I18nText = z.infer<typeof I18nTextSchema>;

const PersonSchema = z.strictObject({ id: UuidSchema, display_name: z.string().min(1).max(200) });

/** Trạng thái bước theo ngôn ngữ nghiệp vụ (UI màu/nhãn theo đây; `raw_status` giữ trạng thái gốc của engine). */
export const RUN_STEP_STATES = [
  "done",
  "running",
  "error",
  "needs_decision",
  "skipped",
  "not_reached",
  "cancelled",
] as const;
export const RunStepStateSchema = z.enum(RUN_STEP_STATES);
export type RunStepState = z.infer<typeof RunStepStateSchema>;

export const RunConditionSchema = z.strictObject({
  /** Số thứ tự luật (1-based) = `rule` của sự kiện rẽ nhánh. */
  rule: z.number().int().min(1),
  field: z.string().min(1).max(100),
  op: z.string().min(1).max(8),
  value: z.union([z.string().max(500), z.number()]),
  goto_step: Int0,
  /** `true` = luật đã khớp lượt này; `false` = chưa/không khớp (chưa tới ⇒ `false`). */
  matched: z.boolean(),
});
export type RunCondition = z.infer<typeof RunConditionSchema>;

export const RunDetailStepSchema = z.strictObject({
  idx: Int0,
  step: Int0,
  name: z.string().min(1).max(200),
  executor: z.strictObject({ kind: z.string().min(1).max(32), name: I18nTextSchema }),
  state: RunStepStateSchema,
  raw_status: StageRunStatusSchema,
  attempt: Int0,
  attempt_limit: Int0,
  round: Int0,
  started_at: IsoDateTime.nullable(),
  finished_at: IsoDateTime.nullable(),
  /** Có cả hai mốc ⇒ ms; đang chạy ⇒ null (client tính theo giờ hiện tại). */
  duration_ms: Int0.nullable(),
  conditions: z.array(RunConditionSchema).max(10),
  /** Câu dễ hiểu cho trạng thái lỗi/chờ/bỏ qua; vắng khi bước bình thường. */
  note: I18nTextSchema.optional(),
});
export type RunDetailStep = z.infer<typeof RunDetailStepSchema>;

export const RUN_TIMELINE_KINDS = [
  "started",
  "step_started",
  "step_done",
  "step_skipped",
  "error",
  "retry",
  "branch",
  "reminder",
  "escalate",
  "decision_requested",
  "decision",
  "review",
  "back",
  "stopped",
  "resumed",
  "rerun",
  "finished",
] as const;
export const RunTimelineKindSchema = z.enum(RUN_TIMELINE_KINDS);
export type RunTimelineKind = z.infer<typeof RunTimelineKindSchema>;

export const RunTimelineItemSchema = z.strictObject({
  at: IsoDateTime,
  kind: RunTimelineKindSchema,
  stage_idx: Int0.nullable(),
  actor: PersonSchema.nullable(),
  text: I18nTextSchema,
});
export type RunTimelineItem = z.infer<typeof RunTimelineItemSchema>;

export const RunDetailSchema = z.strictObject({
  id: UuidSchema,
  tenant: z.strictObject({ id: UuidSchema, name: z.string().max(200) }),
  process: z.strictObject({
    key: ProcessKeySchema,
    name: z.string().min(1).max(200),
    version: Int0,
  }),
  started_by: PersonSchema.nullable(),
  origin: z.strictObject({ kind: OriginKindSchema, label: I18nTextSchema }),
  status: ProcessRunStatusSchema,
  /** Trạng thái + lý do dễ hiểu (vì sao dừng/không chạy, bước kế là gì). */
  status_text: I18nTextSchema,
  decision_reason: DecisionReasonSchema.nullable(),
  current_step: Int0,
  current_stage_idx: Int0,
  current_stage_name: z.string().max(200).nullable(),
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
  is_test: z.boolean(),
  steps: z.array(RunDetailStepSchema).max(RUN_DETAIL_STEPS_MAX),
  timeline: z.array(RunTimelineItemSchema).max(RUN_DETAIL_TIMELINE_MAX),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

// ── Nhật ký một bước ──
export const RUN_LOG_LEVELS = ["basic", "debug"] as const;
export const RunLogLevelSchema = z.enum(RUN_LOG_LEVELS);
export type RunLogLevel = z.infer<typeof RunLogLevelSchema>;

export const RunLogTaskSchema = z.strictObject({
  id: UuidSchema,
  kind: TaskKindSchema,
  status: TaskStatusSchema,
  result: TaskResultSchema.nullable(),
  /** Người/nhóm được giao xử lý (tên hiển thị). */
  assignees: z.array(z.string().min(1).max(200)).max(20),
  decided_by: PersonSchema.nullable(),
  decided_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  /** Bình luận / lý do từ chối / câu hỏi + trả lời, dạng văn bản người dùng nhập. */
  comment: z.string().max(5_000).nullable(),
  question: z.string().max(2_000).nullable(),
  answer: z.string().max(5_000).nullable(),
  /** Câu dễ hiểu cho kết quả (vd "Từ chối — cần sửa lại"). */
  outcome: I18nTextSchema.nullable(),
});
export type RunLogTask = z.infer<typeof RunLogTaskSchema>;

export const RunLogOutputSchema = z.strictObject({
  id: UuidSchema,
  version: Int0,
  attempt: Int0,
  round: Int0,
  template_ok: z.boolean(),
  created_at: IsoDateTime,
  /** CHỈ debug (cắt `RUN_LOG_OUTPUT_CONTENT_MAX`). */
  content: z.string().max(RUN_LOG_OUTPUT_CONTENT_MAX).optional(),
});

export const RunLogJobSchema = z.strictObject({
  id: UuidSchema,
  status: z.string().max(32),
  attempts: Int0,
  error_code: z.string().max(100).nullable(),
  error_reason: z.string().max(100).nullable(),
  error_message: z.string().max(2_000).nullable(),
  queued_at: IsoDateTime.nullable(),
  started_at: IsoDateTime.nullable(),
  finished_at: IsoDateTime.nullable(),
  /** Đầu vào job (payload gốc). */
  payload: z.unknown(),
});

export const RunLogAttemptSchema = z.strictObject({
  run_id: UuidSchema,
  n: z.number().int().min(1),
  status: z.string().max(32),
  error_code: z.string().max(100).nullable(),
  error_message: z.string().max(2_000).nullable(),
  tokens_used: Int0,
  started_at: IsoDateTime,
  finished_at: IsoDateTime.nullable(),
  jobs: z.array(RunLogJobSchema).max(20),
});

export const RunLogDebugSchema = z.strictObject({
  last_error_code: z.string().max(64).nullable(),
  attempts: z.array(RunLogAttemptSchema).max(RUN_LOG_RUNS_MAX),
  retries: z
    .array(
      z.strictObject({
        created_at: IsoDateTime,
        due_at: IsoDateTime,
        fired_at: IsoDateTime.nullable(),
        cancelled_at: IsoDateTime.nullable(),
      }),
    )
    .max(RUN_LOG_RUNS_MAX),
  /** Số truy vấn kh_stage_usage của lượt hiện tại; `null` = bước không dùng KnowledgeHub. */
  kh_queries: Int0.nullable(),
  kh_warning: z.string().max(64).nullable(),
});

export const RunStageLogSchema = z.strictObject({
  level: RunLogLevelSchema,
  run_id: UuidSchema,
  stage: z.strictObject({
    idx: Int0,
    name: z.string().min(1).max(200),
    executor: z.strictObject({ kind: z.string().min(1).max(32), name: I18nTextSchema }),
    state: RunStepStateSchema,
    raw_status: StageRunStatusSchema,
    attempt: Int0,
    attempt_limit: Int0,
    started_at: IsoDateTime.nullable(),
    finished_at: IsoDateTime.nullable(),
    duration_ms: Int0.nullable(),
  }),
  /** Lý do bỏ qua / lỗi diễn đạt dễ hiểu (không có mã lỗi hay thông điệp gốc). */
  skip_reason: I18nTextSchema.nullable(),
  error_text: I18nTextSchema.nullable(),
  tasks: z.array(RunLogTaskSchema).max(RUN_LOG_TASKS_MAX),
  outputs: z.array(RunLogOutputSchema).max(RUN_LOG_OUTPUTS_MAX),
  /** CHỈ có khi `level = debug`. */
  debug: RunLogDebugSchema.optional(),
});
export type RunStageLog = z.infer<typeof RunStageLogSchema>;
