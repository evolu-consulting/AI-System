// contract-flow S2 · mẫu luồng duyệt HĐ theo tenant (`GET|PUT /pack/contracts/approval-flow`). Bước `review` giao một nhóm
// phòng ban (tuỳ chọn chỉ trưởng phòng), hạn/nhắc/chuyển cấp theo giới hạn engine; `when` = AND/OR trên loại HĐ + giá trị
// (giá trị trống ⇒ điều kiện coi là đúng ⇒ cần bước, như `needsLevel2`). Bước `dify` gọi workflow trong catalog, chạy tự động.
// Luật chéo bước (bước 0 không điều kiện, sau Dify không điều kiện, nhóm chuyển cấp ≠ nhóm duyệt) ở domain gói
// (`approval-flow.rules.ts`, lỗi 422 `APPROVAL_FLOW_INVALID` kèm `issues`).
import { z } from "zod";
import { ESCALATE_AFTER_H, ProcessKeySchema, REMIND_EVERY_H } from "../chat/processes";
import { IsoDateTime, UuidSchema } from "../common";
import { CONTRACT_DEALS } from "./milestones";

/** Tối đa 8 bước người dùng thấy (engine ≤ 10 stage: + `route` + `finalize`). */
export const APPROVAL_FLOW_STEPS_MAX = 8;
export const APPROVAL_FLOW_CONDS_MAX = 6;
export const APPROVAL_FLOW_DUE_H = ESCALATE_AFTER_H;
export const APPROVAL_FLOW_REMIND_H = REMIND_EVERY_H;
/** Hạn mặc định một bước (giờ) khi dựng mẫu từ cài đặt cũ. */
export const APPROVAL_FLOW_DUE_DEFAULT_H = 72;
export const APPROVAL_FLOW_VALUE_MAX = 1_000_000_000_000_000;
export const APPROVAL_FLOW_ERRORS = { APPROVAL_FLOW_INVALID: 422 } as const;
export const APPROVAL_FLOW_RULES = [
  "KEY_DUP",
  "STEPS_MAX",
  "FIRST_NOT_REVIEW",
  "FIRST_CONDITIONAL",
  "AFTER_DIFY_CONDITIONAL",
  "GROUP_REQUIRED",
  "ESCALATE_SAME_GROUP",
  "DUE_RANGE",
  "REMIND_RANGE",
] as const;
export type ApprovalFlowRule = (typeof APPROVAL_FLOW_RULES)[number];

const StepKeySchema = z.string().regex(/^[a-z0-9-]{1,24}$/);
const StepNameSchema = z.string().trim().min(1).max(80);

export const FlowCondSchema = z.discriminatedUnion("field", [
  z.strictObject({
    field: z.literal("deal"),
    in: z.array(z.enum(CONTRACT_DEALS)).min(1).max(CONTRACT_DEALS.length),
  }),
  z.strictObject({
    field: z.literal("total_value"),
    op: z.enum(["ge", "gt", "le", "lt"]),
    value: z.number().int().min(0).max(APPROVAL_FLOW_VALUE_MAX),
  }),
]);
export type FlowCond = z.infer<typeof FlowCondSchema>;
export const FlowWhenSchema = z.strictObject({
  op: z.enum(["and", "or"]),
  conds: z.array(FlowCondSchema).min(1).max(APPROVAL_FLOW_CONDS_MAX),
});
export type FlowWhen = z.infer<typeof FlowWhenSchema>;

export const FlowReviewStepSchema = z.strictObject({
  kind: z.literal("review"),
  key: StepKeySchema,
  name: StepNameSchema,
  /** `admin.groups.id` của tenant; `null` chỉ xuất hiện ở mẫu mặc định khi tenant thiếu Group cài đặt (PUT ⇒ 422). */
  department_group_id: UuidSchema.nullable(),
  head_only: z.boolean(),
  /** Hạn quyết (giờ) = mốc chuyển cấp của engine. */
  due_h: z.number().int().min(APPROVAL_FLOW_DUE_H.min).max(APPROVAL_FLOW_DUE_H.max),
  remind_every_h: z
    .number()
    .int()
    .min(APPROVAL_FLOW_REMIND_H.min)
    .max(APPROVAL_FLOW_REMIND_H.max)
    .nullable(),
  escalate_group_id: UuidSchema.nullable(),
  exclude_starter: z.boolean(),
  /** `null` = luôn cần bước. */
  when: FlowWhenSchema.nullable(),
});
export type FlowReviewStep = z.infer<typeof FlowReviewStepSchema>;
export const FlowDifyStepSchema = z.strictObject({
  kind: z.literal("dify"),
  key: StepKeySchema,
  name: StepNameSchema,
  /** Khoá workflow trong catalog đã bật cho tenant. */
  workflow_key: ProcessKeySchema,
  /** Sau khi chạy: `auto` = sang bước kế (bước kế phải không điều kiện). */
  after: z.literal("auto"),
});
export type FlowDifyStep = z.infer<typeof FlowDifyStepSchema>;
export const FlowStepSchema = z.discriminatedUnion("kind", [
  FlowReviewStepSchema,
  FlowDifyStepSchema,
]);
export type FlowStep = z.infer<typeof FlowStepSchema>;
export const FlowStepsSchema = z.array(FlowStepSchema).min(1).max(APPROVAL_FLOW_STEPS_MAX);

export const ApprovalFlowResponseSchema = z.strictObject({
  /** Mẫu mặc định (chưa lưu) = 1; mỗi PUT +1. */
  version: z.number().int().min(1),
  /** true ⇒ chưa lưu, dựng từ `approval-settings` (2 bước cũ). */
  is_default: z.boolean(),
  steps: FlowStepsSchema,
  updated_at: IsoDateTime.nullable(),
});
export type ApprovalFlowResponse = z.infer<typeof ApprovalFlowResponseSchema>;

/** `version` = version đang thấy (khoá lạc quan; lệch ⇒ 409 VERSION_CONFLICT, `details.current` = bản mới nhất). */
export const ApprovalFlowPutSchema = z.strictObject({
  version: z.number().int().min(1),
  steps: FlowStepsSchema,
});
export type ApprovalFlowPut = z.infer<typeof ApprovalFlowPutSchema>;

export const ApprovalFlowIssueSchema = z.strictObject({
  path: z.string().min(1),
  rule: z.enum(APPROVAL_FLOW_RULES),
});
export type ApprovalFlowIssue = z.infer<typeof ApprovalFlowIssueSchema>;
/** 422 `APPROVAL_FLOW_INVALID`.details. */
export const ApprovalFlowInvalidDetailsSchema = z.strictObject({
  issues: z.array(ApprovalFlowIssueSchema).max(40),
});
