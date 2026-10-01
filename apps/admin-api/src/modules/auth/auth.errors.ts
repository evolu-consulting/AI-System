// ADM-FR-01, ADM-FR-02, ADM-FR-06, ADM-FR-07 · mã lỗi của module auth (bảng mã: API_ERRORS, spec M1 §3).
import type { ErrorCode } from "@ai/contracts";
import { appError } from "../../lib/errors";

export const AUTH_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_SUPERSEDED",
  "INVALID_CHANGE_TOKEN",
  "INVALID_CURRENT_PASSWORD",
  "PASSWORD_UNCHANGED",
  "ACCOUNT_LOCKED",
  "TEMP_LOCKED",
] as const satisfies readonly ErrorCode[];

/** 423 `TEMP_LOCKED {until}` (ISO UTC). */
export const tempLocked = (until: Date) => appError("TEMP_LOCKED", { until: until.toISOString() });
