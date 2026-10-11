// HUB-FR-120 · ADM-FR-68 · PB-R02/R08/R21 · mã lỗi nguồn (contract `SOURCE_ERRORS`). Body = `ErrorResponse`; message cố định
// (cross-tenant/không tồn tại cùng một thân — HUB-BR-14, không rò tồn tại).
import { SOURCE_ERRORS, type SourceErrorCode } from "@ai/contracts/hub-admin";
import { AppError } from "../../lib/errors";

const MESSAGES: Record<SourceErrorCode, string> = {
  SOURCE_KEY_TAKEN: "Source key already taken",
  SOURCE_HOST_NOT_ALLOWED: "Git host is not allowed",
  SOURCE_UNRESOLVABLE: "Source could not be resolved",
  SOURCE_IN_USE: "Source is referenced by a process",
  SOURCE_FORBIDDEN_KIND: "You cannot manage this source kind",
  SOURCE_TOO_LARGE: "Source is too large",
  SOURCE_NOT_FOUND: "Source not found",
};

export function sourceError(code: SourceErrorCode, details?: unknown): AppError {
  return new AppError(code, SOURCE_ERRORS[code], MESSAGES[code], details);
}
