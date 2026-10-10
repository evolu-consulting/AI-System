// HUB-FR-105 · lỗi mock quy trình: status theo `CHAT_PROCESS_ERRORS`, body `ErrorResponseSchema` (plan-contract §4).
import { CHAT_PROCESS_ERRORS, type ChatProcessErrorCode } from "@ai/contracts/chat";
import type { Context } from "hono";
import type { ChatVars } from "../auth";
import { chatError, type Parsed } from "../http";

export function processError(c: Context, code: ChatProcessErrorCode, details?: unknown): Response {
  const body = { error: { code, message: code, ...(details ? { details } : {}) } };
  return c.json(body, CHAT_PROCESS_ERRORS[code]);
}
export const forbidden = (c: Context) =>
  c.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, 403);
export const notFound = (c: Context) => chatError(c, "NOT_FOUND");
export const invalid = (c: Context, p: Extract<Parsed<unknown>, { ok: false }>) =>
  chatError(c, "VALIDATION_ERROR", p.issues);
export const me = (c: Context<ChatVars>) => c.get("claims").sub;
