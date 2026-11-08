// contract-flow S2 · mẫu luồng duyệt HĐ theo tenant (`GET|PUT /pack/contracts/approval-flow`). Bước `review` giao một nhóm
// phòng ban (tuỳ chọn chỉ trưởng phòng), hạn/nhắc/chuyển cấp theo giới hạn engine; `when` = AND/OR trên loại HĐ + giá trị
// (giá trị trống ⇒ điều kiện coi là đúng ⇒ cần bước, như `needsLevel2`). Bước `dify` gọi workflow trong catalog, chạy tự động.
// Luật chéo bước (bước 0 không điều kiện, sau Dify không điều kiện, nhóm chuyển cấp ≠ nhóm duyệt) ở domain gói
// (`approval-flow.rules.ts`, lỗi 422 `APPROVAL_FLOW_INVALID` kèm `issues`).
import { z } from "zod";
import { ESCALATE_AFTER_H, ProcessKeySchema, REMIND_EVERY_H } from "../chat/processes";
import { INPUT_NAME_RE, INPUT_SCHEMA_MAX, IsoDateTime, UuidSchema } from "../common";
import { GROUP_KEY_RE } from "../groups";
import { CONTRACT_DEALS } from "./milestones";

/** CR-121 D-1 · tối đa 20 bước người dùng thấy (engine ≤ 22 stage: + `route` + `finalize`); migration hub 0097 nới CHECK
 *  (`process_defs_stages_ck`, `process_runs_step_ck`, `back_to_step`, `from_step`, chỉ số stage) — bất biến ở dưới giữ hai trần khớp. */
export const APPROVAL_FLOW_STEPS_MAX = 20;
/** Stage hệ thống quy trình duyệt thêm ngoài bước người dùng: `route` + `finalize` (Ký số không là stage engine). */
export const APPROVAL_FLOW_SYSTEM_STAGES = 2;
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
  /** CR-121 D-6 · bước Thông báo thiếu người nhận / kênh / tiêu đề; bước Chờ tới lệch ngày ngoài ±365. */
  "NOTIFY_TO_REQUIRED",
  "NOTIFY_CHANNEL_REQUIRED",
  "NOTIFY_TITLE_REQUIRED",
  "WAIT_OFFSET_RANGE",
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

/**
 * CR-121 D-0 · trường nghiệp vụ dùng trong điều kiện (khai ở `SlotSpec.fields` của khe `contracts.approval`). `deal` +
 * `total_value` giữ nguyên hình/nghĩa cũ (def/run prod không đổi). `creator_department` = phòng ban người tạo HĐ (tính cả phòng
 * con) theo MÃ Group (def thư viện dùng chung nhiều tenant); `new_partner` = đối tác chưa có HĐ nào được duyệt. Xét giá trị HIỆN
 * TẠI mỗi lần rẽ; dữ liệu trống ⇒ điều kiện ĐÚNG (bước vẫn chạy, xem trước ghi "chưa có dữ liệu").
 */
export const FLOW_COND_FIELDS = [
  "deal",
  "total_value",
  "creator_department",
  "new_partner",
] as const;
export type FlowCondField = (typeof FLOW_COND_FIELDS)[number];
export const FLOW_NUM_OPS = ["ge", "gt", "le", "lt"] as const;
/** Số phòng ban tối đa trong một điều kiện `creator_department`. */
export const APPROVAL_FLOW_COND_GROUPS_MAX = 20;

export const FlowCondSchema = z.discriminatedUnion("field", [
  z.strictObject({
    field: z.literal("deal"),
    in: z.array(z.enum(CONTRACT_DEALS)).min(1).max(CONTRACT_DEALS.length),
  }),
  z.strictObject({
    field: z.literal("total_value"),
    op: z.enum(FLOW_NUM_OPS),
    value: z.number().int().min(0).max(APPROVAL_FLOW_VALUE_MAX),
  }),
  z.strictObject({
    field: z.literal("creator_department"),
    in: z.array(z.string().regex(GROUP_KEY_RE)).min(1).max(APPROVAL_FLOW_COND_GROUPS_MAX),
  }),
  z.strictObject({ field: z.literal("new_partner"), is: z.boolean() }),
]);
export type FlowCond = z.infer<typeof FlowCondSchema>;
/** CR-121 D-0 · nhóm điều kiện lồng MỘT cấp (phần tử không có `field`; bên trong chỉ điều kiện lá). */
export const FlowCondGroupSchema = z.strictObject({
  op: z.enum(["and", "or"]),
  conds: z.array(FlowCondSchema).min(1).max(APPROVAL_FLOW_CONDS_MAX),
});
export type FlowCondGroup = z.infer<typeof FlowCondGroupSchema>;
export const FlowWhenSchema = z.strictObject({
  op: z.enum(["and", "or"]),
  conds: z
    .array(z.union([FlowCondSchema, FlowCondGroupSchema]))
    .min(1)
    .max(APPROVAL_FLOW_CONDS_MAX),
});
export type FlowWhen = z.infer<typeof FlowWhenSchema>;
/** Phần tử của `FlowWhen.conds` là nhóm lồng (không phải điều kiện lá). */
export const isFlowCondGroup = (c: FlowCond | FlowCondGroup): c is FlowCondGroup => !("field" in c);
/** Mọi điều kiện lá của `when` (trải phẳng nhóm lồng) — cho chỗ chỉ hiển thị/kiểm từng điều kiện. */
export const flowLeafConds = (w: FlowWhen): FlowCond[] =>
  w.conds.flatMap((c) => (isFlowCondGroup(c) ? c.conds : [c]));

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
/** CR-121 D-6 · bước "Thông báo" (chạy xong là sang bước kế; thiếu người nhận/kênh/tiêu đề ⇒ lỗi kiểm `NOTIFY_*`). */
export const FlowNotifyStepSchema = z.strictObject({
  kind: z.literal("notify"),
  key: StepKeySchema,
  name: StepNameSchema,
  to: z.strictObject({
    creator: z.boolean(),
    owner: z.boolean(),
    group_key: z.string().regex(GROUP_KEY_RE).nullable(),
  }),
  channels: z.array(z.enum(["bell", "email"])).max(2),
  /** Mẫu có biến `{ma_hd}` `{ten_hd}` `{gia_tri}`. */
  title: z.string().max(200),
  body: z.string().max(2000),
});
export type FlowNotifyStep = z.infer<typeof FlowNotifyStepSchema>;
/** CR-121 D-6 · bước "Chờ tới": ngày của HĐ + số ngày lệch, lúc `time` (giờ công ty). */
export const FLOW_WAIT_OFFSET_DAYS = { min: -365, max: 365 } as const;
export const FlowWaitStepSchema = z.strictObject({
  kind: z.literal("wait_until"),
  key: StepKeySchema,
  name: StepNameSchema,
  from: z.enum(["end_date", "action_deadline"]),
  offset_days: z.number().int(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export type FlowWaitStep = z.infer<typeof FlowWaitStepSchema>;
export const FlowStepSchema = z.discriminatedUnion("kind", [
  FlowReviewStepSchema,
  FlowDifyStepSchema,
  FlowEsignStepSchema,
  FlowNotifyStepSchema,
  FlowWaitStepSchema,
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
  kind: z.enum(["review", "dify", "esign", "notify", "wait_until"]),
  /** Điều kiện áp dụng (vắng/null = luôn chạy). */
  when: FlowWhenSchema.nullable().optional(),
  /** CR-108 · tất cả tuỳ chọn (client cũ bỏ qua): hạn xử lý giờ, nhắc mỗi giờ, nhóm nhận khi quá hạn, số người duyệt còn dùng được. */
  due_h: z.number().int().min(1).optional(),
  remind_every_h: z.number().int().min(1).optional(),
  escalate_group_name: z.string().max(200).nullable().optional(),
  approver_count: z.number().int().min(0).optional(),
  /** CR-113 · true ⇒ nhóm nhận khi quá hạn (`escalate_group_name`) là MẶC ĐỊNH Toàn quyền (bước có hạn, không đặt nhóm chuyển cấp). */
  escalate_default: z.boolean().optional(),
  /** CR-113 (review) · nhóm chuyển cấp đặt tường minh đã bị xoá ⇒ lỗi cấu hình (lượt mới kẹt `FLOW_GROUP_MISSING`). */
  escalate_group_missing: z.literal(true).optional(),
});
export type ApprovalFlowCurrentStep = z.infer<typeof ApprovalFlowCurrentStepSchema>;
export const ApprovalFlowCurrentSchema = z.strictObject({
  def_id: UuidSchema,
  name: z.string().min(1).max(200),
  rel_version: z.number().int().min(1),
  /** Đã gỡ ở CR-125 · S2 (không còn "mặc định của khe": flow đang chạy lấy từ `company_flows`); giữ tuỳ chọn cho client cũ. */
  is_default: z.boolean().optional(),
  /** CR-125 · S2 · các bước hiển thị của flow (Duyệt / Ký số / Thông báo); flow chỉ có bước kỹ thuật ⇒ rỗng. */
  steps: z.array(ApprovalFlowCurrentStepSchema).max(APPROVAL_FLOW_STEPS_MAX),
  /** CR-125 · S2 · flow có node Nếu (rẽ nhánh theo điều kiện) ⇒ danh sách là các bước CÓ THỂ chạy. */
  has_branches: z.boolean().optional(),
  /** CR-125 · S2 · số flow Bật khác cùng sự kiện (xét sau flow hiển thị). */
  other_flows: z.number().int().min(0).optional(),
  /** CR-113 · chủ gói (Toàn quyền) duyệt thay được mọi bước — ghi rõ "duyệt thay" trên thẻ. */
  owner_can_override: z.literal(true).optional(),
  /** CR-113 · tên Group Toàn quyền (đích chuyển cấp mặc định); không có ở tenant ⇒ null. */
  owner_group_name: z.string().max(200).nullable().optional(),
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
