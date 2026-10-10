// HUB-FR-104 · HUB-FR-114 · ADM-FR-65 · B3 (0c) · `/process-defs*`, `GET /agent-teams` (plan §8 hàng 0c). Bước 0: khung rỗng.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import type { ProcessDeps } from "../core/ports";

export function defsRoutes(_d: ProcessDeps): Hono<AuthVars> {
  return new Hono<AuthVars>();
}
