// HUB-FR-112 · PF3 · `GET /me/review-tasks`, `GET /me/process-inbox`, `POST /me/process-inbox/read` (plan §9). Bước 0: khung rỗng.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import type { ProcessDeps } from "../core/ports";

export function inboxRoutes(_d: ProcessDeps): Hono<AuthVars> {
  return new Hono<AuthVars>();
}
