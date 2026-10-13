// HUB-FR-66 · HUB-FR-67 · HUB-FR-78 · spec H4b2 §3 (cuối C) · path param `:id`/`:agent_id`/`:tenant_id` của route Models +
// Quyền agent không phải uuid ⇒ 400 `VALIDATION_ERROR` (khác `parseIdParam` của H4a: 404). Route H4a giữ nguyên.
import { UuidSchema } from "@ai/contracts";
import type { Context, MiddlewareHandler } from "hono";
import { validationError } from "../../lib/http";

/** Đọc path param `name`; không phải uuid ⇒ 400 path `[name]`. */
export function parseUuidParam(c: Context, name = "id"): string {
  const v = c.req.param(name);
  if (!UuidSchema.safeParse(v).success)
    throw validationError([{ path: [name], code: "invalid_format", message: "Invalid uuid" }]);
  return v as string;
}

/**
 * Middleware cho `/<base>/:id/*`: chặn 400 trước cả khi path con chưa có handler (vd `/:id/check` mount ở task sau) —
 * thứ tự 401 → 403 → 400 giữ cho mọi path con.
 */
export function uuidParams(...names: string[]): MiddlewareHandler {
  return async (c, next) => {
    for (const n of names) parseUuidParam(c, n);
    await next();
  };
}
