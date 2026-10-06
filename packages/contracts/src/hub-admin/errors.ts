// HUB-FR-78, HUB-FR-79, HUB-FR-52 · mã lỗi API quản trị Hub (plan H3b §2.1). Body = `ErrorResponseSchema` M0.
// Không thêm vào CHAT_API_ERRORS (test khoá C1: đúng 6 mã; R21) — dùng kèm VALIDATION_ERROR/AUTH_EXPIRED/NOT_FOUND/INTERNAL_ERROR.
import { z } from "zod";
import { UuidSchema } from "../common";

/** Status theo Admin `API_ERRORS`. */
export const HUB_ADMIN_ERRORS = {
  FORBIDDEN: 403,
  TENANT_REQUIRED: 400,
  INVALID_REFERENCE: 400,
  NOT_ENTITLED: 409,
  AGENT_NOT_GRANTABLE: 409,
} as const satisfies Record<string, 400 | 403 | 409>;

export type HubAdminErrorCode = keyof typeof HUB_ADMIN_ERRORS;
export const HUB_ADMIN_ERROR_CODES = Object.keys(HUB_ADMIN_ERRORS) as HubAdminErrorCode[];
export const HubAdminErrorCodeSchema = z.enum(
  HUB_ADMIN_ERROR_CODES as [HubAdminErrorCode, ...HubAdminErrorCode[]],
);

/** R04: lỗi agent che lỗi subject — `field` cho biết tham chiếu nào sai. */
export const InvalidReferenceDetailsSchema = z.strictObject({
  field: z.enum(["agent_id", "subject_id"]),
});
export type InvalidReferenceDetails = z.infer<typeof InvalidReferenceDetailsSchema>;

/** POST một grant (Q-K5, PL12) ⇒ đúng một id. */
export const NotEntitledDetailsSchema = z.strictObject({
  agent_ids: z.array(UuidSchema).min(1).max(1),
});
export type NotEntitledDetails = z.infer<typeof NotEntitledDetailsSchema>;
