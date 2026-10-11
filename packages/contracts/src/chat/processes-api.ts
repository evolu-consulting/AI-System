// HUB-FR-105…117 · CR-056 · request/response endpoint quy trình phía Chat (plan-contract §3). Mọi object strict.
// Tên schema chốt ở plan-contract §3 (bảng "Tên schema", B2).
import { z } from "zod";
import { CountSchema, UuidSchema } from "../common";
import {
  DEF_INPUTS_MAX,
  ProcessInputDefSchema,
  ProcessInputValueSchema,
} from "../hub-admin/sources";
import { CHAT_ASK_CHOICE_MAX } from "./entities";
import {
  ANSWER_MAX,
  DecisionOptionSchema,
  FEEDBACK_MAX,
  FORWARD_NOTE_MAX,
  OPEN_TASKS_COUNT_MAX,
  PROCESS_DESC_MAX,
  PROCESS_INPUT_MAX,
  PROCESS_LIST_LIMIT,
  PROCESS_NAME_MAX,
  PROCESS_STAGES_MAX,
  PROCESS_SYSTEM_SENDER,
  ProcessKeySchema,
  ProcessRunStatusSchema,
  TaskStatusSchema,
} from "./processes";
import {
  PROCESS_SECTIONS_MAX,
  ProcessNoticeSchema,
  ProcessRefSchema,
  ProcessRunSummarySchema,
  ProcessRunViewSchema,
  TaskDetailSchema,
  UserRefSchema,
} from "./processes-entities";

/** Danh sách `GET /processes` ≤ 200 (không phân trang). */
export const PROCESS_CATALOG_MAX = 200;
const CursorSchema = z.string().min(1).max(512);
const LimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PROCESS_LIST_LIMIT.max)
  .default(PROCESS_LIST_LIMIT.default);

// ---------- GET /processes ----------
export const ProcessCatalogItemSchema = z.strictObject({
  key: ProcessKeySchema,
  name: z.string().min(1).max(PROCESS_NAME_MAX),
  description: z.string().max(PROCESS_DESC_MAX),
  input_hint: z.string().max(PROCESS_DESC_MAX),
  stage_count: z.number().int().min(1).max(PROCESS_STAGES_MAX),
  /** HUB-FR-124 · C2 · khai báo đầu vào quy trình (`!key` form); server luôn gửi mảng (def không khai ⇒ []).
   * `optional` để tương thích FE/fixtures cũ (bổ sung không phá) — FS-9. */
  inputs: z.array(ProcessInputDefSchema).max(DEF_INPUTS_MAX).optional(),
});
export type ProcessCatalogItem = z.infer<typeof ProcessCatalogItemSchema>;
export const ProcessListResponseSchema = z.strictObject({
  items: z.array(ProcessCatalogItemSchema).max(PROCESS_CATALOG_MAX),
});
export type ProcessListResponse = z.infer<typeof ProcessListResponseSchema>;

// ---------- POST /process-runs ----------
export const ProcessRunOriginInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("room"), room_id: UuidSchema }),
  z.strictObject({ kind: z.literal("conversation"), conversation_id: UuidSchema }),
  z.strictObject({ kind: z.literal("none") }),
]);
export const CreateProcessRunRequestSchema = z.strictObject({
  process_key: ProcessKeySchema,
  input: z.string().trim().max(PROCESS_INPUT_MAX),
  origin: ProcessRunOriginInputSchema,
  /** HUB-FR-124 · C19 · giá trị đầu vào (`!key` form); vắng = tương thích P-a. `pinned_sources` KHÔNG nhận từ client. */
  inputs: z.array(ProcessInputValueSchema).max(DEF_INPUTS_MAX).optional(),
});
export type CreateProcessRunRequest = z.infer<typeof CreateProcessRunRequestSchema>;
/** 201 `POST /process-runs`, `POST /process-runs/:id/cancel`, `POST /process-defs/:id/run`. */
export const CreateProcessRunResponseSchema = ProcessRunSummarySchema;
/** 200 `POST /process-runs/:id/decide` — VIEW đầy đủ (như `GET /process-runs/:id`): admin ngoài phòng refetch từ /decide
 * (plan-contract §3). Tóm tắt không đủ ⇒ trả `ProcessRunView`. */
export const DecideProcessRunResponseSchema = ProcessRunViewSchema;
/** 202 `POST /conversations/:id/messages` khi nội dung là `!key …`. */
export const ConversationProcessStartResponseSchema = z.strictObject({
  process_run: ProcessRunSummarySchema,
});
export type ConversationProcessStartResponse = z.infer<
  typeof ConversationProcessStartResponseSchema
>;

// ---------- GET /process-runs ----------
export const ProcessRunListQuerySchema = z.strictObject({
  scope: z.enum(["mine", "tenant"]).default("mine"),
  process_key: ProcessKeySchema.optional(),
  room_id: UuidSchema.optional(),
  conversation_id: UuidSchema.optional(),
  status: ProcessRunStatusSchema.optional(),
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
  tenant_id: UuidSchema.optional(),
});
export type ProcessRunListQuery = z.infer<typeof ProcessRunListQuerySchema>;
export const ProcessRunListResponseSchema = z.strictObject({
  items: z.array(ProcessRunSummarySchema).max(PROCESS_LIST_LIMIT.max),
  next_cursor: z.string().nullable(),
});
export type ProcessRunListResponse = z.infer<typeof ProcessRunListResponseSchema>;
/** `GET /process-runs/:id` (+ output, usage): `tenant_id` chỉ platform_admin. */
export const ProcessRunGetQuerySchema = z.strictObject({ tenant_id: UuidSchema.optional() });

// ---------- cancel / decide ----------
export const CancelProcessRunRequestSchema = z.strictObject({});
export const DecideProcessRunRequestSchema = z.strictObject({
  option: DecisionOptionSchema,
  note: z.string().trim().max(FORWARD_NOTE_MAX).optional(),
});
export type DecideProcessRunRequest = z.infer<typeof DecideProcessRunRequestSchema>;

// ---------- GET /me/review-tasks ----------
export const ReviewTaskListQuerySchema = z.strictObject({
  status: TaskStatusSchema.default("open"),
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
});
export type ReviewTaskListQuery = z.infer<typeof ReviewTaskListQuerySchema>;
export const ReviewTaskListItemSchema = z.strictObject({
  task: TaskDetailSchema,
  process_run: z.strictObject({
    id: UuidSchema,
    process: ProcessRefSchema,
    status: ProcessRunStatusSchema,
    started_by: UserRefSchema,
  }),
});
export type ReviewTaskListItem = z.infer<typeof ReviewTaskListItemSchema>;
export const ReviewTaskListResponseSchema = z.strictObject({
  items: z.array(ReviewTaskListItemSchema).max(PROCESS_LIST_LIMIT.max),
  /** Mọi task mở của tôi (không phụ thuộc `status`), kẹp ở OPEN_TASKS_COUNT_MAX. */
  open_count: z.number().int().min(0).max(OPEN_TASKS_COUNT_MAX),
  next_cursor: z.string().nullable(),
});
export type ReviewTaskListResponse = z.infer<typeof ReviewTaskListResponseSchema>;

// ---------- POST /review-tasks/:id/{decision,answer,forward} (200 TaskDetail) ----------
/** `fail` thiếu/rỗng `feedback` ⇒ 422 FEEDBACK_REQUIRED ở luật (`reviewDecisionCheck`), không phải zod 400. */
export const ReviewDecisionRequestSchema = z.strictObject({
  result: z.enum(["pass", "fail"]),
  // `fail` góp ý rỗng/khoảng trắng ⇒ 422 FEEDBACK_REQUIRED ở luật (`reviewDecisionCheck`), KHÔNG zod 400 ⇒ không `.min(1)`.
  feedback: z.string().trim().max(FEEDBACK_MAX).optional(),
  sections: z
    .array(z.string().trim().min(1).max(PROCESS_NAME_MAX))
    .max(PROCESS_SECTIONS_MAX)
    .optional(),
});
export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequestSchema>;
export const ReviewAnswerRequestSchema = z.strictObject({
  answer: z.string().trim().min(1).max(ANSWER_MAX),
  choice: z.string().min(1).max(CHAT_ASK_CHOICE_MAX).optional(),
});
export type ReviewAnswerRequest = z.infer<typeof ReviewAnswerRequestSchema>;
export const ForwardReviewTaskRequestSchema = z.strictObject({
  to_user_id: UuidSchema,
  note: z.string().trim().max(FORWARD_NOTE_MAX).optional(),
});
export type ForwardReviewTaskRequest = z.infer<typeof ForwardReviewTaskRequestSchema>;
export const ReviewTaskResponseSchema = TaskDetailSchema;

// ---------- DM "Quy trình" ----------
export const ProcessInboxQuerySchema = z.strictObject({
  limit: LimitSchema,
  cursor: CursorSchema.optional(),
});
export const ProcessInboxResponseSchema = z.strictObject({
  sender: z.strictObject({
    key: z.literal(PROCESS_SYSTEM_SENDER.key),
    name: z.strictObject({ vi: z.string().min(1), en: z.string().min(1) }),
  }),
  items: z.array(ProcessNoticeSchema).max(PROCESS_LIST_LIMIT.max),
  unread: CountSchema,
  next_cursor: z.string().nullable(),
});
export type ProcessInboxResponse = z.infer<typeof ProcessInboxResponseSchema>;
export const MarkProcessInboxReadRequestSchema = z.strictObject({ up_to_id: UuidSchema });
export type MarkProcessInboxReadRequest = z.infer<typeof MarkProcessInboxReadRequestSchema>;
export const MarkProcessInboxReadResponseSchema = z.strictObject({ unread: CountSchema });
export type MarkProcessInboxReadResponse = z.infer<typeof MarkProcessInboxReadResponseSchema>;
