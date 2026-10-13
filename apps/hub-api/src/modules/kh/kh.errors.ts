// HUB-FR-131 · HUB-FR-132 · spec K1 §3.2 · lỗi riêng KH (contract `HUB_KH_ERRORS`). Body = `ErrorResponse`, message cố định —
// không URL, không khoá, không thân trả về của KH.
import { HUB_KH_ERRORS, type HubKhErrorCode } from "@ai/contracts/hub-admin";
import { AppError } from "../../lib/errors";

const MESSAGES: Record<HubKhErrorCode, string> = {
  KH_CONNECTION_EXISTS: "KnowledgeHub connection already exists",
  KH_CONNECTION_IN_USE: "KnowledgeHub connection is in use by agents",
  KH_URL_NOT_ALLOWED: "KnowledgeHub URL is not allowed",
  KH_SECRET_INVALID: "Secret cannot be used for KnowledgeHub",
  KH_AGENT_RUNTIME: "Only agentic-cli agents can use KnowledgeHub",
  KH_CONNECTION_NOT_FOUND: "KnowledgeHub connection not found",
};

export function khError(code: HubKhErrorCode, details?: unknown): AppError {
  return new AppError(code, HUB_KH_ERRORS[code], MESSAGES[code], details);
}
