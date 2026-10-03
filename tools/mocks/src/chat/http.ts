// CHAT-AC-31 · tiện ích HTTP dùng chung của mock chat: đọc body JSON theo schema, lỗi kênh chat (plan C1 §2.4).
import { CHAT_API_ERRORS, type ChatErrorCode } from "@ai/contracts/chat";
import type { Context } from "hono";
import type { z } from "zod";

export type Issue = { path: (string | number)[]; code: string; message: string };
export type Parsed<T> = { ok: true; data: T } | { ok: false; issues: Issue[] };

const MESSAGES: Record<ChatErrorCode, string> = {
  VALIDATION_ERROR: "Invalid request",
  AUTH_EXPIRED: "Access token expired or invalid",
  NOT_FOUND: "Not found",
  FLOW_BUSY: "Flow is running",
  EVENTS_EXPIRED: "Run events expired",
  INTERNAL_ERROR: "Internal error",
};

/** Lỗi kênh chat: status theo `CHAT_API_ERRORS`, body `ErrorResponseSchema` (không chứa dữ liệu người dùng). */
export function chatError(c: Context, code: ChatErrorCode, issues?: Issue[]): Response {
  const details = issues ? { details: { issues } } : {};
  return c.json({ error: { code, message: MESSAGES[code], ...details } }, CHAT_API_ERRORS[code]);
}

/** Parse một giá trị theo schema; issue đã bỏ `symbol` trong path. */
export function parseWith<T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const issues = r.error.issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p !== "symbol"),
    code: i.code,
    message: i.message,
  }));
  return { ok: false, issues };
}

/** Body JSON theo schema; body rỗng → `{}`; JSON hỏng → issue `invalid_json`. */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  const text = await c.req.text();
  let raw: unknown = {};
  try {
    if (text.trim() !== "") raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: [], code: "invalid_json", message: "Invalid JSON" }] };
  }
  return parseWith(schema, raw);
}
