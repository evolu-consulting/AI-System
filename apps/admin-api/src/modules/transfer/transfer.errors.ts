// ADM-FR-54 · mã lỗi của module transfer (bảng mã: API_ERRORS, plan-cd §3.3, §4.3) + đổi `ConfigVersionMoved` → 409.
import type { ErrorCode } from "@ai/contracts";
import { ConfigVersionMoved } from "@ai/db";
import { appError } from "../../lib/errors";

export const TRANSFER_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VERSION_CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "IMPORT_INVALID",
  "SECRETS_REQUIRED",
] as const satisfies readonly ErrorCode[];

/** Import áp dụng: config đổi sau dry-run (plan-cd D8) → 409 `VERSION_CONFLICT {current}`; lỗi khác ném lại. */
export function mapVersionMoved(err: unknown): never {
  if (err instanceof ConfigVersionMoved)
    throw appError("VERSION_CONFLICT", { current: err.current });
  throw err;
}
