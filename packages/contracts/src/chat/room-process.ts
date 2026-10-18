// HUB-FR-113 · U1 · CR-056 · phần `process` của tin phòng `sender_type="process"` (plan-thread §2, plan-contract §2).
// Mọi nhánh mang `process_run_id`; `forward` không chép `note` (riêng tư của task).
import { z } from "zod";
import { UuidSchema } from "../common";
import { CHAT_ASK_CHOICE_MAX, CHAT_ASK_CHOICES_MAX, CHAT_ASK_QUESTION_MAX } from "./entities";
import {
  BRANCH_RULES_MAX,
  DecisionOptionSchema,
  DecisionReasonSchema,
  FEEDBACK_MAX,
  FORWARD_CHAIN_MAX,
  PROCESS_NAME_MAX,
  PROCESS_STAGES_MAX,
  ProcessStepSchema,
  StageAfterSchema,
  StageIdxSchema,
  StepRoleSchema,
  TaskKindSchema,
  TaskResultSchema,
} from "./processes";
import {
  ExecutorRefSchema,
  OutputRefSchema,
  PROCESS_SECTIONS_MAX,
  ProcessRefSchema,
  StepAgentRefSchema,
  UserRefSchema,
} from "./processes-entities";

export const ROOM_PROCESS_KINDS = [
  "block",
  "output",
  "ask",
  "decision",
  "task_result",
  "forward",
  "run_end",
  // P-d2 · PD2-R13 · stage rẽ nhánh sang bước `to_step` theo luật `rule` (1-based).
  "branch",
] as const;
export type RoomProcessKind = (typeof ROOM_PROCESS_KINDS)[number];
/** `content` tóm tắt của tin `process` (preview + dự phòng). */
export const ROOM_PROCESS_CONTENT_MAX = 500;
export const ROOM_PROCESS_STEPS_MAX = 10;
export const ROOM_PROCESS_END_STATUSES = ["done", "cancelled", "failed", "expired"] as const;

const run = { process_run_id: UuidSchema };
const StageNameSchema = z.string().min(1).max(PROCESS_NAME_MAX);
const Int0 = z.number().int().min(0);

export const RoomProcessStepSchema = z.strictObject({
  role: StepRoleSchema,
  member_key: z.string().min(1).nullable(),
  agent: StepAgentRefSchema,
  model: z.string().min(1).nullable(),
  ms: Int0.nullable(),
  tokens: Int0,
});

export const RoomProcessPartSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("block"),
    ...run,
    process: ProcessRefSchema,
    stage_count: z.number().int().min(1).max(PROCESS_STAGES_MAX),
  }),
  z.strictObject({
    kind: z.literal("output"),
    ...run,
    stage_idx: StageIdxSchema,
    stage_name: StageNameSchema,
    executor: ExecutorRefSchema,
    output: OutputRefSchema,
    after: StageAfterSchema,
    review_task_id: UuidSchema.nullable(),
    steps: z.array(RoomProcessStepSchema).max(ROOM_PROCESS_STEPS_MAX),
  }),
  z.strictObject({
    kind: z.literal("ask"),
    ...run,
    stage_idx: StageIdxSchema,
    stage_name: StageNameSchema,
    executor: ExecutorRefSchema,
    task_id: UuidSchema,
    question: z.string().min(1).max(CHAT_ASK_QUESTION_MAX),
    choices: z.array(z.string().min(1).max(CHAT_ASK_CHOICE_MAX)).max(CHAT_ASK_CHOICES_MAX),
    asks_count: Int0,
    ask_limit: Int0,
  }),
  z.strictObject({
    kind: z.literal("decision"),
    ...run,
    stage_idx: StageIdxSchema,
    task_id: UuidSchema,
    reason: DecisionReasonSchema,
    options: z.array(DecisionOptionSchema).max(3),
  }),
  z.strictObject({
    kind: z.literal("task_result"),
    ...run,
    stage_idx: StageIdxSchema,
    task_id: UuidSchema,
    task_kind: TaskKindSchema,
    result: TaskResultSchema,
    actor: UserRefSchema,
    /** Người làm không là thành viên phòng (T8). */
    outside: z.boolean(),
    feedback: z.string().max(FEEDBACK_MAX).optional(),
    answer: z.string().max(FEEDBACK_MAX).optional(),
    choice: z.string().min(1).max(CHAT_ASK_CHOICE_MAX).optional(),
    sections: z.array(z.string().min(1)).max(PROCESS_SECTIONS_MAX).optional(),
    /** P-b2 · review `fail` có quay lại bước. */
    to_step: ProcessStepSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("forward"),
    ...run,
    stage_idx: StageIdxSchema,
    task_id: UuidSchema,
    /** B2: FE chọn câu — `ask` ⇒ `ask.fwd.line`, khác ⇒ `thread.forward.line`. */
    task_kind: TaskKindSchema,
    from: UserRefSchema,
    to: UserRefSchema,
    depth: z.number().int().min(1).max(FORWARD_CHAIN_MAX),
  }),
  z.strictObject({
    kind: z.literal("run_end"),
    ...run,
    status: z.enum(ROOM_PROCESS_END_STATUSES),
    actor: UserRefSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("branch"),
    ...run,
    stage_idx: StageIdxSchema,
    to_step: ProcessStepSchema,
    rule: z.number().int().min(1).max(BRANCH_RULES_MAX),
  }),
]);
export type RoomProcessPart = z.infer<typeof RoomProcessPartSchema>;
