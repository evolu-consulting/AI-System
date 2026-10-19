// HD-FR-31…37 · HD3 spec §3: flow duyệt hợp đồng trên engine N2 (`/pack/contracts/contracts/:id/approval`,
// `/pack/contracts/approval-settings`). Chỉ thêm — không đổi schema HD1/HD2.
import { z } from "zod";
import { IsoDateTime } from "../common";

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
export const APPROVAL_ACTIONS = ["approve", "reject", "redo"] as const;

/** `reject`/`redo` cần lý do (engine trả 422 `FEEDBACK_REQUIRED` khi thiếu — giữ một nguồn luật). */
export const ApprovalActionRequestSchema = z.strictObject({
  action: z.enum(APPROVAL_ACTIONS),
  feedback: z.string().trim().max(APPROVAL_FEEDBACK_MAX).optional(),
});
export type ApprovalActionRequest = z.infer<typeof ApprovalActionRequestSchema>;

export const ContractApprovalSchema = z.strictObject({
  run_id: z.uuid().nullable(),
  run_status: z.string().max(32).nullable(),
  step: ApprovalStepSchema.nullable(),
  task_id: z.uuid().nullable(),
  can_act: z.boolean(),
  feedback: z.string().max(APPROVAL_FEEDBACK_MAX).nullable(),
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
