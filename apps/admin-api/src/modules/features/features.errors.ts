// ADM-FR-30, ADM-FR-31 · mã lỗi của module features (bảng mã: API_ERRORS, spec M2 §3) + dịch 23505 (plan §7).
import type { ErrorCode } from "@ai/contracts";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";

export const FEATURES_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "KEY_TAKEN",
  "INVALID_REFERENCE",
  "COMMAND_NEEDS_FEATURE",
  "CORE_FEATURE_PROTECTED",
  "FEATURE_HAS_EXCLUSIVE_COMMANDS",
] as const satisfies readonly ErrorCode[];

export function mapFeatureConflict(err: unknown): never {
  if (uniqueViolation(err) === "features_key_uq") throw appError("KEY_TAKEN");
  throw err;
}
