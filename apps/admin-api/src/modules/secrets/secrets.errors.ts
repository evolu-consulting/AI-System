// ADM-FR-50 · mã lỗi của module secrets (bảng mã: API_ERRORS, spec M2 §3) + dịch lỗi Postgres (plan M2 §7).
import type { ErrorCode } from "@ai/contracts";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";

export const SECRETS_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SECRET_NAME_TAKEN",
  "SECRET_IN_USE",
  "INTERNAL_ERROR",
] as const satisfies readonly ErrorCode[];

export function mapSecretConflict(err: unknown): never {
  if (uniqueViolation(err) === "secrets_name_uq") throw appError("SECRET_NAME_TAKEN");
  throw err;
}
