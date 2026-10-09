// ADM-FR-20, ADM-BR-01 · mã lỗi của module commands (bảng mã: API_ERRORS, spec M2 §3) + nhận diện 23505 tên (plan §7).
import type { ErrorCode } from "@ai/contracts";
import { uniqueViolation } from "../../lib/pg-errors";

export const COMMANDS_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_REFERENCE",
  "COMMAND_NAME_TAKEN",
  "INPUT_MAP_INVALID",
  "WORKFLOW_DISABLED",
] as const satisfies readonly ErrorCode[];

/** 23505 trên `commands_name_uq` hoặc `command_names_pkey`: hai request đua cùng tên/alias. */
export function isNameConflict(err: unknown): boolean {
  const c = uniqueViolation(err);
  return c === "commands_name_uq" || c === "command_names_pkey";
}
