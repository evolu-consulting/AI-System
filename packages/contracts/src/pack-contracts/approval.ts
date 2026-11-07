// HD-FR-31…37 · HD3 spec §3: flow duyệt hợp đồng trên engine N2 (`/pack/contracts/contracts/:id/approval`,
// `/pack/contracts/approval-settings`). Chỉ thêm — không đổi schema HD1/HD2.
import { z } from "zod";
import { IsoDateTime } from "../common";
import { FlowCondSchema } from "./approval-flow";
import { ProductLinksSchema } from "./product-links";

export const APPROVAL_STEPS = [
  "extract",
  "level1",
  "value",
  "level2",
  "finalize",
  "done",
  "rejected",
  "cancelled",
] as const;
export const ApprovalStepSchema = z.enum(APPROVAL_STEPS);
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;

export const APPROVAL_FEEDBACK_MAX = 4000;
/** `return` (Trả lại về bước soạn) chỉ có ở lượt chạy trên engine (`mode = 'engine'`); máy cũ ⇒ 409 APPROVAL_NOT_OPEN. */
export const APPROVAL_ACTIONS = ["approve", "reject", "redo", "return"] as const;
// biome-ignore lint/suspicious/noControlCharactersInRegex: chặn đúng các ký tự điều khiển
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** `reject`/`redo` cần lý do (engine trả 422 `FEEDBACK_REQUIRED` khi thiếu — giữ một nguồn luật). */
export const ApprovalActionRequestSchema = z.strictObject({
  action: z.enum(APPROVAL_ACTIONS),
  // Review B #29: ký tự điều khiển (NUL ⇒ Postgres 22021 ⇒ 500) bị chặn ở biên; giữ \t \n \r.
  feedback: z
    .string()
    .trim()
    .max(APPROVAL_FEEDBACK_MAX)
    .refine((v) => !CONTROL_CHARS.test(v), { message: "control characters are not allowed" })
    .optional(),
  /** products-confirm: gắn/tạo SP cho dòng HĐ — chỉ áp khi `approve` làm HĐ thành "đã xác nhận" (cùng tx); bước khác bỏ qua. */
  products: ProductLinksSchema.optional(),
});
export type ApprovalActionRequest = z.infer<typeof ApprovalActionRequestSchema>;

/** contract-flow S3b · một bước của thẻ duyệt trên engine (chỉ bước người dùng của luồng; không gồm stage rẽ/ghi). */
export const APPROVAL_STEP_STATUSES = [
  "pending",
  "open",
  "passed",
  "skipped",
  "returned",
  "rejected",
  /** cf-dify · bước Dify: đang chạy / lỗi hết lượt retry (cần người xử lý). */
  "running",
  "failed",
] as const;
/** esign-flow · trạng thái bước Ký số: chờ duyệt xong / đang gửi / đã gửi chờ ký / ký xong / cần quyết. */
export const ESIGN_FLOW_STATUSES = [
  "pending",
  "sending",
  "sent",
  "completed",
  "needs_decision",
] as const;
export const ESIGN_FLOW_REASONS = [
  "NO_PARTNER_EMAIL",
  "NO_SIGNER",
  "SEND_FAILED",
  "DECLINED",
  "VOIDED",
] as const;
export type EsignFlowStatus = (typeof ESIGN_FLOW_STATUSES)[number];
export type EsignFlowReason = (typeof ESIGN_FLOW_REASONS)[number];
export const ApprovalCardStepSchema = z.strictObject({
  /** Chỉ số bước người dùng trong mẫu chụp (0 = bước soạn). */
  idx: z.number().int().min(0),
  key: z.string().max(64),
  name: z.string().max(200),
  /** CR-121 D-6 · + bước Thông báo / Chờ tới (tự chạy như Dify, không Group). */
  kind: z.enum(["review", "dify", "notify", "wait_until"]),
  status: z.enum(APPROVAL_STEP_STATUSES),
  /** Group (phòng) duyệt; null ở bước Dify. UI đổi ra tên qua `GET /pack/contracts/groups`. */
  group_id: z.uuid().nullable(),
  /** Chỉ trưởng phòng của Group quyết được. */
  head_only: z.boolean(),
  escalated_group_id: z.uuid().nullable(),
  due_at: IsoDateTime.nullable(),
  escalated: z.boolean(),
  decided_by: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  decided_at: IsoDateTime.nullable(),
  feedback: z.string().max(APPROVAL_FEEDBACK_MAX).nullable(),
  /** CR-109 · bước chưa tới mà theo giá trị/loại HĐ hiện tại sẽ bị bỏ qua: các điều kiện `when` không thỏa; null/vắng = không bỏ qua. */
  skip_when: z.array(FlowCondSchema).nullable().optional(),
  /** CR-113 · bước đã quyết: người của bước (`member`) hay chủ gói "duyệt thay" (`owner_override`); chưa quyết ⇒ vắng. */
  decided_as: z.enum(["member", "owner_override"]).optional(),
  /** CR-123 · u6 · bước là MỘT node module (Ký số gộp gửi + chờ): trạng thái nghiệp vụ; vắng ở bước thường / hub cũ. */
  outcome: z.enum(["pending", "waiting", "done", "declined", "expired", "failed"]).optional(),
  /** CR-123 · u6 · tên người / phòng ký công ty của bước module. */
  signer: z.string().max(200).optional(),
  /** CR-124 · q6 · khoá node của bước module (vd `contracts.partner-send`) ⇒ thẻ dùng đúng chữ trạng thái. */
  module_node: z.string().max(100).optional(),
  /** CR-113 · bước đang mở đã quá hạn (giờ server); vắng ở bước không mở. */
  overdue: z.boolean().optional(),
  /** CR-113 · tên Group nhận khi chuyển cấp đã xảy ra. */
  escalated_to: z.string().max(200).optional(),
  /** CR-123 U2 · bước Thông báo không có người nhận (bước vẫn xong): hub điền khi sẵn sàng; vắng ⇒ không cảnh báo. */
  warning: z.literal("NOTIFY_NO_RECIPIENT").optional(),
});
export type ApprovalCardStep = z.infer<typeof ApprovalCardStepSchema>;

/** `GET /pack/contracts/groups` · Group của tenant (id + tên) cho UI luồng duyệt. */
export const ContractGroupSchema = z.strictObject({ id: z.uuid(), name: z.string() });
export type ContractGroup = z.infer<typeof ContractGroupSchema>;

/** CR-107 · `ContractApproval.attention` (xem chú thích trường). */
export const ApprovalAttentionSchema = z.strictObject({
  kind: z.enum(["needs_decision", "stalled"]),
  reason: z.string().max(200).nullable(),
  since: z.string().max(40).nullable(),
  /** CR-122 · p19 · mã máy lỗi của bước tự động (vd `ESIGN_DISABLED`, `MISSING_ARG:contract_id`); vắng ở hub cũ. */
  code: z.string().max(64).nullable().optional(),
  /** CR-122 · P18 · `reason = missing_fact`: NHÃN các dữ kiện còn trống (vd "Giá trị hợp đồng"). Vắng ở lý do khác / hub cũ. */
  missing: z.array(z.string().max(120)).max(6).optional(),
});
export type ApprovalAttention = z.infer<typeof ApprovalAttentionSchema>;

export const ContractApprovalSchema = z.strictObject({
  run_id: z.uuid().nullable(),
  /** CR-121 F-2 · lượt chạy trên engine quy trình (id `hub.process_runs`; KHÁC `run_id` = lượt duyệt của gói): đích của trang
   *  "Chi tiết lượt chạy" (`GET /process-runs/:id/detail`). null ⇒ lượt kẹt chưa có run; vắng ⇒ máy cũ / hub cũ. */
  engine_run_id: z.uuid().nullable().optional(),
  run_status: z.string().max(32).nullable(),
  step: ApprovalStepSchema.nullable(),
  task_id: z.uuid().nullable(),
  can_act: z.boolean(),
  feedback: z.string().max(APPROVAL_FEEDBACK_MAX).nullable(),
  /** Bước đang mở mà người xem không quyết được: vì sao (thẻ duyệt nói rõ thay vì chỉ "đang chờ"). Vắng ở hub cũ. */
  block_reason: z.enum(["not_reviewer", "starter"]).nullable().optional(),
  /** products-confirm: "Xác nhận/Duyệt" của người xem sẽ làm HĐ thành "đã xác nhận" ⇒ hộp "Gắn sản phẩm". Vắng ở hub cũ. */
  finalizes_on_approve: z.boolean().optional(),
  /** S3b · `engine` ⇒ lượt chạy trên engine quy trình (có `steps`); vắng ⇒ máy 2 bước cũ. */
  mode: z.enum(["machine", "engine"]).optional(),
  steps: z.array(ApprovalCardStepSchema).optional(),
  /** CR-124 · q6 · thẻ dựng từ lượt FLOW THEO SỰ KIỆN: bước 0 là stage thật của quy trình (vd Duyệt) — KHÔNG phải bước soạn «Gửi duyệt» của máy cũ. */
  from_run: z.boolean().optional(),
  /** fix-review · run đã kết thúc bất thường, lượt còn mở: owner/admin bấm "Mở lại quy trình" (POST .../approval/reopen). */
  needs_reopen: z.boolean().optional(),
  /** CR-107 · lượt engine cần owner/admin để ý (không đổi trạng thái HĐ): `needs_decision` ⇒ run kẹt chờ quyết (vd
   *  `retry_exhausted`, `tool_failed`) — owner bấm "Thử lại" (POST .../approval/retry) hoặc "Huỷ & mở lại"
   *  (POST .../approval/cancel-reopen); `stalled` ⇒ run đã kết thúc bất thường / chưa mở được (vd `FLOW_GROUP_MISSING:<mã>`)
   *  — "Mở lại quy trình". `reason` = mã engine/gói; `since` = lúc engine mở quyết định (ISO) hoặc null. Vắng ở hub cũ. */
  attention: ApprovalAttentionSchema.nullable().optional(),
  /** esign-flow · bước Ký số cuối luồng (vắng/null ⇒ luồng không có bước ký). */
  esign: z
    .strictObject({
      key: z.string().max(64),
      name: z.string().max(200),
      status: z.enum(ESIGN_FLOW_STATUSES),
      reason: z.enum(ESIGN_FLOW_REASONS).nullable(),
      /** Người xem bấm được "Gửi lại" (người phụ trách HĐ / owner gói) khi bước cần quyết. */
      can_resend: z.boolean(),
      /** esign-sweep2 · hạn ký (`esign_at + due_h`, ISO) khi phong bì đã gửi chờ ký; vắng/null ⇒ không hiện. */
      due_at: z.string().max(40).nullable().optional(),
      /** esign-sweep2 · đã gửi chờ ký mà quá hạn (giờ server). */
      overdue: z.boolean().optional(),
      /** esign-sweep2 · lần nhắc người ký gần nhất của lần gửi hiện tại (ISO). */
      reminded_at: z.string().max(40).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type ContractApproval = z.infer<typeof ContractApprovalSchema>;

/** HD-FR-37 · mặc định: ngưỡng intake-hd câu 3; Group tự quyết D3-12 (spec HD3 §5). */
export const APPROVAL_SETTINGS_DEFAULT = {
  threshold: 500_000_000,
  level1_group_key: "contracts-editor",
  level2_group_key: "contracts-owner",
} as const;
const GroupKeySchema = z.string().regex(/^[a-z0-9-]{2,64}$/);
export const ApprovalSettingsSchema = z.strictObject({
  threshold: z.number().int().min(0).max(1_000_000_000_000_000),
  level1_group_key: GroupKeySchema,
  level2_group_key: GroupKeySchema,
});
export type ApprovalSettingsBody = z.infer<typeof ApprovalSettingsSchema>;
export const ApprovalSettingsPatchSchema = ApprovalSettingsSchema.partial();

/** Mã lỗi riêng HD3 (khối riêng, không sửa `CONTRACT_ERRORS` của HD1/HD2). */
export const CONTRACT_APPROVAL_ERRORS = {
  /** HĐ không có task duyệt đang mở (run đã xong / đang trích / chưa có run). */
  APPROVAL_NOT_OPEN: 409,
  /** Người gọi không thuộc Group duyệt của bước. */
  NOT_REVIEWER: 403,
  /** Khoá Group trong cài đặt không có ở tenant. */
  APPROVAL_GROUP_MISSING: 422,
  /** #221 · trần thao tác AI theo tenant/ngày. */
  ACTION_QUOTA: 429,
} as const;
export const ActionQuotaDetailsSchema = z.strictObject({
  limit: z.number().int().min(1),
  resets_at: IsoDateTime,
});
