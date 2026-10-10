// HUB-FR-107 · PF1 · `POST /review-tasks/:id/decision` (plan §9, plan-contract §3). Bước 0: khung rỗng.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import type { ProcessDeps } from "../core/ports";

export function gatesRoutes(_d: ProcessDeps): Hono<AuthVars> {
  return new Hono<AuthVars>();
}
