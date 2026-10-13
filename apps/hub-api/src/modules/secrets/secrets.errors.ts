// HUB-FR-68 · HUB-FR-69 · spec H4b-1 §3 Mã lỗi · plan D11 · lỗi riêng secrets (contract `HUB_SECRET_ERRORS`) + 409
// `NOT_CONFIGURED` (Hub thiếu `HUB_SECRETS_KEY`). Body = `ErrorResponse`, message cố định — không bao giờ chứa giá trị.
import { HUB_SECRET_ERRORS, type HubSecretErrorCode } from "@ai/contracts/hub-admin";
import { AppError } from "../../lib/errors";

const MESSAGES: Record<HubSecretErrorCode, string> = {
  SECRET_NAME_TAKEN: "Secret name already taken",
  SECRET_IN_USE: "Secret is in use",
};

export function secretError(code: HubSecretErrorCode, details?: unknown): AppError {
  return new AppError(code, HUB_SECRET_ERRORS[code], MESSAGES[code], details);
}

/** D11 · Hub không có khoá ⇒ không ghi được giá trị (list/get/delete vẫn chạy). */
export function secretsNotConfigured(): AppError {
  return new AppError("NOT_CONFIGURED", 409, "Hub secrets key is not configured");
}
