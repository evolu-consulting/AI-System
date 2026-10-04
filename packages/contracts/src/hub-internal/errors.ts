// HUB-FR-89 · mã lỗi HTTP `/internal/*` của Hub (plan H2a §2.3–2.4); body = `ErrorResponseSchema` M0.
import { z } from "zod";

export const HUB_INTERNAL_ERRORS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_CONFIGURED: 409,
  CMD_MISSING_ARG: 422,
  INTERNAL_ERROR: 500,
  UNAVAILABLE: 503,
} as const satisfies Record<string, 400 | 401 | 409 | 422 | 500 | 503>;

export type HubInternalErrorCode = keyof typeof HUB_INTERNAL_ERRORS;
export type HubInternalErrorStatus = (typeof HUB_INTERNAL_ERRORS)[HubInternalErrorCode];
export const HUB_INTERNAL_ERROR_CODES = Object.keys(HUB_INTERNAL_ERRORS) as HubInternalErrorCode[];
export const HubInternalErrorCodeSchema = z.enum(
  HUB_INTERNAL_ERROR_CODES as [HubInternalErrorCode, ...HubInternalErrorCode[]],
);
