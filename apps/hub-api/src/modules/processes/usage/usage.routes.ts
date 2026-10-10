// HUB-FR-116 · HUB-FR-117 · PF4 · `GET /process-runs/:id/usage` (plan §6, §9). Bước 0: khung rỗng.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import type { ProcessDeps } from "../core/ports";

export function usageRoutes(_d: ProcessDeps): Hono<AuthVars> {
  return new Hono<AuthVars>();
}
