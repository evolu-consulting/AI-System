// HD-FR-31…37 · HD3 spec §3: flow duyệt hợp đồng trên engine N2 (`/pack/contracts/contracts/:id/approval`,
// `/pack/contracts/approval-settings`). Chỉ thêm — không đổi schema HD1/HD2.
import { z } from "zod";
import { IsoDateTime } from "../common";
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
export const ApprovalCardStepSchema = z.strictObject({
  /** Chỉ số bước người dùng trong mẫu chụp (0 = bước soạn). */
  idx: z.number().int().min(0),
  key: z.string().max(64),
  name: z.string().max(200),
  kind: z.enum(["review", "dify"]),
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
});
export type ApprovalCardStep = z.infer<typeof ApprovalCardStepSchema>;

/** `GET /pack/contracts/groups` · Group của tenant (id + tên) cho UI luồng duyệt. */
export const ContractGroupSchema = z.strictObject({ id: z.uuid(), name: z.string() });
export type ContractGroup = z.infer<typeof ContractGroupSchema>;

export const ContractApprovalSchema = z.strictObject({
  run_id: z.uuid().nullable(),
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
