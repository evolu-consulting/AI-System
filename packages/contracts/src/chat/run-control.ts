// CR-121 · R-1 · điều khiển lượt chạy (quản trị): `POST /process-runs/:id/{stop,rerun-step,rerun}`. Mọi thao tác bắt buộc lý do
// (enum) — ghi người làm + lý do + thời điểm vào `hub.audit_log` cho dòng thời gian. Mọi object strict.
import { z } from "zod";
import { StageIdxSchema } from "./processes";

export const RUN_CONTROL_REASONS = ["sent_by_mistake", "needs_edit", "bad_data", "other"] as const;
export const RunControlReasonSchema = z.enum(RUN_CONTROL_REASONS);
export type RunControlReason = z.infer<typeof RunControlReasonSchema>;

/** Dừng lượt chạy (platform_admin; tenant_admin cùng tenant). */
export const StopProcessRunRequestSchema = z.strictObject({ reason: RunControlReasonSchema });
export type StopProcessRunRequest = z.infer<typeof StopProcessRunRequestSchema>;

/** Chạy lại từ một bước trong CÙNG lượt (chỉ platform_admin): `stage_idx` = stage của bước cần chạy lại. */
export const RerunStepRequestSchema = z.strictObject({
  reason: RunControlReasonSchema,
  stage_idx: StageIdxSchema,
});
export type RerunStepRequest = z.infer<typeof RerunStepRequestSchema>;

/** Chạy lại cả lượt ⇒ lượt MỚI cùng định nghĩa + đầu vào (platform_admin; tenant_admin cùng tenant). */
export const RerunProcessRunRequestSchema = z.strictObject({ reason: RunControlReasonSchema });
export type RerunProcessRunRequest = z.infer<typeof RerunProcessRunRequestSchema>;
