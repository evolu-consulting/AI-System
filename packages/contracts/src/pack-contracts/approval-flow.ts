// contract-flow S2 · mẫu luồng duyệt HĐ theo tenant (`GET|PUT /pack/contracts/approval-flow`). Bước `review` giao một nhóm
// phòng ban (tuỳ chọn chỉ trưởng phòng), hạn/nhắc/chuyển cấp theo giới hạn engine; `when` = AND/OR trên loại HĐ + giá trị
// (giá trị trống ⇒ điều kiện coi là đúng ⇒ cần bước, như `needsLevel2`). Bước `dify` gọi workflow trong catalog, chạy tự động.
// Luật chéo bước (bước 0 không điều kiện, sau Dify không điều kiện, nhóm chuyển cấp ≠ nhóm duyệt) ở domain gói
// (`approval-flow.rules.ts`, lỗi 422 `APPROVAL_FLOW_INVALID` kèm `issues`).
import { z } from "zod";
import { ESCALATE_AFTER_H, ProcessKeySchema, REMIND_EVERY_H } from "../chat/processes";
import { INPUT_NAME_RE, INPUT_SCHEMA_MAX, IsoDateTime, UuidSchema } from "../common";
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
  "DIFY_WORKFLOW_UNKNOWN",
  "DIFY_PARAM_UNSUPPORTED",
  /** dify-input-map · khoá `inputs` không có trong input_schema của workflow. */
  "DIFY_INPUT_UNKNOWN",
  /** esign-flow · tối đa 1 bước Ký số, phải là bước cuối. */
  "ESIGN_MULTI",
  "ESIGN_NOT_LAST",
  /** esign-flow · người ký công ty `dept_head` thiếu phòng / `user` thiếu người. */
  "SIGNER_GROUP_REQUIRED",
  "SIGNER_USER_REQUIRED",
  /** esign-flow · người (duyệt/ký) không thuộc công ty hoặc không có quyền gói hợp đồng. */
  "USER_NOT_MEMBER",
] as const;
export type ApprovalFlowRule = (typeof APPROVAL_FLOW_RULES)[number];

/** dify-input-map · dữ liệu HĐ có thể gán cho tham số workflow Dify. */
export const FLOW_CONTRACT_FIELDS = [
  "contract_id",
  "title",
  "deal",
  "total_value",
  "partner",
] as const;
export type FlowContractField = (typeof FLOW_CONTRACT_FIELDS)[number];

/** dify-input-map · nhãn loại HĐ chấp nhận cho tham số `select` (so khớp không phân biệt hoa thường / dấu). */
export const FLOW_DEAL_LABELS = {
  buy: ["mua", "mua hang", "buy", "purchase"],
  sell: ["ban", "ban hang", "sell", "sale"],
  referral: ["gioi thieu", "referral"],
} as const;
const normLabel = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").trim().toLowerCase();
/** Loại HĐ ⇒ lựa chọn tương ứng của tham số `select`; thiếu một loại ⇒ null (không ánh xạ được). Mirror ở domain hub-api. */
export function flowDealOptionMap(
  options: readonly string[] | undefined,
): Record<"buy" | "sell" | "referral", string> | null {
  const out: Partial<Record<"buy" | "sell" | "referral", string>> = {};
  for (const d of ["buy", "sell", "referral"] as const) {
    const hit = (options ?? []).find((o) =>
      (FLOW_DEAL_LABELS[d] as readonly string[]).includes(normLabel(o)),
    );
    if (hit === undefined) return null;
    out[d] = hit;
  }
  return out as Record<"buy" | "sell" | "referral", string>;
}

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
  /** esign-flow · người duyệt cụ thể (thay cho phòng khi đặt): user của tenant có quyền gói; vắng/null ⇒ theo phòng. */
  approver_user_id: UuidSchema.nullable().optional(),
});
export type FlowReviewStep = z.infer<typeof FlowReviewStepSchema>;
export const ESIGN_SIGNER_MODES = ["owner", "dept_head", "user"] as const;
/** esign-flow · người ký phía công ty: người phụ trách HĐ / trưởng phòng của Group / người cụ thể. */
export const FlowEsignSignerSchema = z.strictObject({
  mode: z.enum(ESIGN_SIGNER_MODES),
  department_group_id: UuidSchema.nullable().optional(),
  user_id: UuidSchema.nullable().optional(),
});
export type FlowEsignSigner = z.infer<typeof FlowEsignSignerSchema>;
/** esign-flow · bước Ký số (bước cuối): duyệt xong ⇒ tự gửi ký; ký xong ⇒ luồng kết thúc; từ chối/huỷ ⇒ cần quyết. */
export const FlowEsignStepSchema = z.strictObject({
  kind: z.literal("esign"),
  key: StepKeySchema,
  name: StepNameSchema,
  company_signer: FlowEsignSignerSchema,
  /** Đối tác ký (email từ liên hệ đối tác của HĐ; thiếu ⇒ bước dừng "cần quyết"). */
  partner_signs: z.boolean(),
  order: z.enum(["company_first", "partner_first"]),
  /** Khoá nhà cung cấp; null = mặc định công ty. */
  provider: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .nullable(),
  due_h: z.number().int().min(APPROVAL_FLOW_DUE_H.min).max(APPROVAL_FLOW_DUE_H.max),
  remind_every_h: z
    .number()
    .int()
    .min(APPROVAL_FLOW_REMIND_H.min)
    .max(APPROVAL_FLOW_REMIND_H.max)
    .nullable(),
  escalate_group_id: UuidSchema.nullable(),
});
export type FlowEsignStep = z.infer<typeof FlowEsignStepSchema>;
export const FlowDifyStepSchema = z.strictObject({
  kind: z.literal("dify"),
  key: StepKeySchema,
  name: StepNameSchema,
  /** Khoá workflow trong catalog đã bật cho tenant. */
  workflow_key: ProcessKeySchema,
  /** dify-input-map · tham số workflow ⇒ trường HĐ; vắng ⇒ khớp theo cùng tên (như cũ). */
  inputs: z
    .record(z.string().regex(INPUT_NAME_RE), z.enum(FLOW_CONTRACT_FIELDS))
    .refine((m) => Object.keys(m).length <= INPUT_SCHEMA_MAX, { message: "too many keys" })
    .optional(),
  /** Sau khi chạy: `auto` = sang bước kế (bước kế phải không điều kiện). */
  after: z.literal("auto"),
});
export type FlowDifyStep = z.infer<typeof FlowDifyStepSchema>;
export const FlowStepSchema = z.discriminatedUnion("kind", [
  FlowReviewStepSchema,
  FlowDifyStepSchema,
  FlowEsignStepSchema,
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

/** CR-105 L4 · `GET /pack/contracts/approval-flow` CHỈ ĐỌC: quy trình đang dùng của tenant (gán ⇒ mặc định của khe), phòng ban theo TÊN. */
export const ApprovalFlowCurrentStepSchema = z.strictObject({
  name: z.string().min(1).max(80),
  /** Tên phòng ban (Group của tenant); bước không gắn phòng (Dify, ký số theo người phụ trách) ⇒ null. */
  department_name: z.string().max(200).nullable(),
  kind: z.enum(["review", "dify", "esign"]),
  /** Điều kiện áp dụng (vắng/null = luôn chạy). */
  when: FlowWhenSchema.nullable().optional(),
});
export type ApprovalFlowCurrentStep = z.infer<typeof ApprovalFlowCurrentStepSchema>;
export const ApprovalFlowCurrentSchema = z.strictObject({
  def_id: UuidSchema,
  name: z.string().min(1).max(200),
  rel_version: z.number().int().min(1),
  /** true ⇒ tenant chưa được gán riêng, đang chạy mặc định của khe. */
  is_default: z.boolean(),
  steps: z.array(ApprovalFlowCurrentStepSchema).min(1).max(APPROVAL_FLOW_STEPS_MAX),
});
export type ApprovalFlowCurrent = z.infer<typeof ApprovalFlowCurrentSchema>;

/** cf-dify · `GET /pack/contracts/dify-workflows`: workflow Dify tenant được dùng làm bước Dify (đã bật ở catalog). */
export const DifyWorkflowInputSchema = z.strictObject({
  name: z.string().regex(INPUT_NAME_RE),
  type: z.string().min(1).max(32),
  required: z.boolean(),
  description: z.string().max(500).optional(),
  /** Lựa chọn của tham số `select`. */
  options: z.array(z.string().max(200)).max(100).optional(),
});
export type DifyWorkflowInput = z.infer<typeof DifyWorkflowInputSchema>;
export const DifyWorkflowItemSchema = z.strictObject({
  key: ProcessKeySchema,
  name: z.string().min(1).max(128),
  /** dify-input-map · tham số khai trong input_schema (để UI ánh xạ trường HĐ). */
  inputs: z.array(DifyWorkflowInputSchema).max(INPUT_SCHEMA_MAX),
});
export type DifyWorkflowItem = z.infer<typeof DifyWorkflowItemSchema>;
export const DifyWorkflowsResponseSchema = z.strictObject({
  items: z.array(DifyWorkflowItemSchema).max(200),
});
export type DifyWorkflowsResponse = z.infer<typeof DifyWorkflowsResponseSchema>;

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
