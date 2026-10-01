// ADM-FR-10, ADM-FR-13 · mã lỗi của module workflows (bảng mã: API_ERRORS, spec M2 §3) + dịch 23505 (plan §7).
import type { ErrorCode } from "@ai/contracts";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";

export const WORKFLOWS_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "KEY_TAKEN",
  "INVALID_REFERENCE",
  "WORKFLOW_IN_USE",
  "SCHEMA_BREAKS_COMMANDS",
] as const satisfies readonly ErrorCode[];

export function mapWorkflowConflict(err: unknown): never {
  if (uniqueViolation(err) === "workflows_key_uq") throw appError("KEY_TAKEN");
  throw err;
}
