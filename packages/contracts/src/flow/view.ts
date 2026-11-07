// CR-118 · UW-FR-10/11/13/14 · ADR-0035: view model "app chạy theo flow tại khe" — hub `GET /pack/:k/flow/:slot/:ref`,
// `POST /pack/:k/flow/:slot/:ref/tasks/:id/actions/:action`, `POST /pack/:k/flow/:slot/summary`. Web vẽ theo loại bước
// (`FLOW_STEP_KINDS`); map renderer `FlowStepRenderers<R>` bắt buộc đủ mọi loại ⇒ thiếu renderer = lỗi typecheck. Loại lạ trong
// snapshot cũ không có ở đây: server luôn chiếu về một loại đã biết (`system` khi không có renderer riêng).
import { z } from "zod";
import { FlowFormSchema, FlowFormValuesSchema } from "./form";

export const FLOW_REF_MAX_BATCH = 100;
/** Khe `<gói>.<việc>` (khớp CHECK `process_slots_slot_ck`). */
export const FlowSlotKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}\.[a-z][a-z0-9_-]{1,47}$/);
/** Mã thực thể của khe (uuid với gói hiện có; gói tự kiểm dạng). */
export const FlowRefSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Key = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const Text = (max: number) => z.string().max(max);
/** Mốc giờ ISO do server tạo (chuỗi ≤ 40, có thể kèm offset). */
const At = z.string().min(10).max(40);

/** Loại bước (loại gói hiện có review/dify/esign + `form` mới + wait/system của engine; CR-120 G1: `agent` = executor agent/team). */
export const FLOW_STEP_KINDS = [
  "review",
  "dify",
  "esign",
  "form",
  "wait",
  "system",
  "agent",
] as const;
export type FlowStepKind = (typeof FLOW_STEP_KINDS)[number];
export const FLOW_STEP_STATUSES = [
  "pending",
  "open",
  "running",
  "passed",
  "skipped",
  "returned",
  "rejected",
  "failed",
  "needs_decision",
] as const;
export type FlowStepStatus = (typeof FLOW_STEP_STATUSES)[number];
/** Trạng thái chung của lượt chạy tại khe. */
export const FLOW_STATES = ["none", "running", "done", "rejected", "cancelled"] as const;
export type FlowState = (typeof FLOW_STATES)[number];

export const FlowAssigneeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("group"),
    id: z.uuid().nullable(),
    label: Text(200).nullable(),
    head_only: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("user"), id: z.uuid(), label: Text(200).nullable() }),
  z.strictObject({ kind: z.literal("system") }),
]);
export type FlowAssignee = z.infer<typeof FlowAssigneeSchema>;

/** Điều kiện "bỏ qua" có cấu trúc (không biểu thức). */
export const FlowSkipCondSchema = z.strictObject({
  field: Key,
  /** CR-121 D-0 · `is` + giá trị có/không cho trường boolean (vd đối tác mới). */
  op: z.enum(["ge", "gt", "le", "lt", "in", "is"]),
  value: z.union([z.number(), z.boolean(), z.array(z.string().max(64)).max(20)]),
});

const StepBase = {
  key: Key,
  name: Text(200),
  status: z.enum(FLOW_STEP_STATUSES),
  assignee: FlowAssigneeSchema.nullable(),
  due_at: At.nullable(),
  overdue: z.boolean(),
  escalated: z.boolean(),
  escalated_to: Text(200).nullable(),
  decided_by: z.strictObject({ id: z.uuid(), name: Text(200) }).nullable(),
  decided_at: At.nullable(),
  decided_as: z.enum(["member", "owner_override"]).nullable(),
  feedback: Text(4000).nullable(),
  /** Bước chưa tới sẽ bị bỏ qua theo dữ liệu hiện tại: điều kiện không thỏa; null = không bỏ qua. */
  skip_when: z.array(FlowSkipCondSchema).max(20).nullable(),
  /** CR-123 U2 · bước Thông báo xong nhưng không có người nhận ⇒ thẻ nói rõ cho chủ HĐ (vắng ở hub cũ / bước khác). */
  warning: z.literal("NOTIFY_NO_RECIPIENT").optional(),
};
export const FlowStepViewSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...StepBase, kind: z.literal("review") }),
  z.strictObject({ ...StepBase, kind: z.literal("dify") }),
  z.strictObject({
    ...StepBase,
    kind: z.literal("esign"),
    esign: z.strictObject({
      provider_status: z.enum(["pending", "sending", "sent", "completed", "needs_decision"]),
      reason: Key.nullable(),
      can_resend: z.boolean(),
      reminded_at: At.nullable(),
    }),
  }),
  z.strictObject({ ...StepBase, kind: z.literal("form"), form: FlowFormSchema }),
  z.strictObject({ ...StepBase, kind: z.literal("wait"), until: At.nullable() }),
  z.strictObject({ ...StepBase, kind: z.literal("system") }),
  /** CR-120 G1 · bước agent: khoá agent Hub + tóm tắt kết quả (text thuần, đã lọc ở server; null khi chưa chạy/lỗi). */
  z.strictObject({
    ...StepBase,
    kind: z.literal("agent"),
    agent: z.strictObject({ key: Key, summary: Text(400).nullable() }),
  }),
]);
export type FlowStepView = z.infer<typeof FlowStepViewSchema>;
export type FlowStepViewOf<K extends FlowStepKind> = Extract<FlowStepView, { kind: K }>;
/** Map renderer của web: thiếu một loại ⇒ lỗi typecheck. */
export type FlowStepRenderers<R> = { [K in FlowStepKind]: (step: FlowStepViewOf<K>) => R };

/** Đầu vào của hành động (kiểu cố định; `extension` = phần riêng của gói, gói tự kiểm bằng schema của mình). */
export const FlowActionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("feedback"),
    required: z.boolean(),
    max_len: z.number().int().min(1).max(4000),
  }),
  z.strictObject({ kind: z.literal("form"), form: FlowFormSchema }),
  z.strictObject({ kind: z.literal("extension"), key: Key, required: z.boolean() }),
]);
export type FlowActionInput = z.infer<typeof FlowActionInputSchema>;
export const FlowActionDefSchema = z.strictObject({
  key: Key,
  label: Text(80),
  style: z.enum(["primary", "default", "danger"]),
  confirm: z.boolean(),
  input: FlowActionInputSchema,
});
export type FlowActionDef = z.infer<typeof FlowActionDefSchema>;
export const FlowTaskSchema = z.strictObject({
  task_id: z.uuid(),
  step_key: Key,
  kind: z.enum(FLOW_STEP_KINDS),
  actions: z.array(FlowActionDefSchema).max(10),
});
export type FlowTask = z.infer<typeof FlowTaskSchema>;

export const FlowAttentionSchema = z.strictObject({
  kind: z.enum(["needs_decision", "stalled"]),
  reason: Text(200).nullable(),
  since: Text(40).nullable(),
});

export const FlowViewSchema = z.strictObject({
  slot: FlowSlotKeySchema,
  ref: FlowRefSchema,
  /** Lượt chạy + phiên bản SNAPSHOT định nghĩa (renderer vẽ theo bản run đang chạy, không theo bản mới xuất bản). */
  run: z
    .strictObject({
      id: z.uuid(),
      mode: z.enum(["engine", "machine"]),
      status: Text(32).nullable(),
      snapshot_version: z.number().int().min(0).nullable(),
    })
    .nullable(),
  state: z.enum(FLOW_STATES),
  /** Giai đoạn của gói (vd `extract`/`level1`) — chỉ hiển thị, renderer không rẽ theo. */
  phase: Key.nullable(),
  note: Text(4000).nullable(),
  attention: FlowAttentionSchema.nullable(),
  block_reason: z.enum(["not_reviewer", "starter"]).nullable(),
  steps: z.array(FlowStepViewSchema).max(32),
  /** Task ĐANG MỞ của người xem (rỗng ⇒ không quyết được gì). */
  tasks: z.array(FlowTaskSchema).max(10),
});
export type FlowView = z.infer<typeof FlowViewSchema>;

export const FlowActionRequestSchema = z.strictObject({
  feedback: z
    .string()
    .trim()
    .max(4000)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: chặn đúng các ký tự điều khiển
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), {
      message: "control characters are not allowed",
    })
    .optional(),
  values: FlowFormValuesSchema.optional(),
  extension: z.unknown().optional(),
});
export type FlowActionRequest = z.infer<typeof FlowActionRequestSchema>;
export const FlowActionResultSchema = z.strictObject({ view: FlowViewSchema });
export type FlowActionResult = z.infer<typeof FlowActionResultSchema>;

export const FlowSummaryRequestSchema = z.strictObject({
  refs: z
    .array(FlowRefSchema)
    .min(1)
    .max(FLOW_REF_MAX_BATCH)
    .refine((r) => new Set(r).size === r.length, { message: "duplicate ref" }),
});
export type FlowSummaryRequest = z.infer<typeof FlowSummaryRequestSchema>;
/** Huy hiệu danh sách. Ref không thấy được (tenant khác / không quyền / không tồn tại) ⇒ VẮNG khỏi `items`. */
export const FlowSummaryItemSchema = z.strictObject({
  ref: FlowRefSchema,
  state: z.enum(FLOW_STATES),
  phase: Key.nullable(),
  snapshot_version: z.number().int().min(0).nullable(),
  attention: z.boolean(),
});
export type FlowSummaryItem = z.infer<typeof FlowSummaryItemSchema>;
export const FlowSummarySchema = z.strictObject({
  slot: FlowSlotKeySchema,
  items: z.array(FlowSummaryItemSchema).max(FLOW_REF_MAX_BATCH),
});
export type FlowSummary = z.infer<typeof FlowSummarySchema>;
