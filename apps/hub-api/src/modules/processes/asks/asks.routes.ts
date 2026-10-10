// HUB-FR-110 · HUB-FR-111 · PF2 · `POST /review-tasks/:id/{answer,forward}` (plan §9, plan-contract §3). Bước 0: khung rỗng.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import type { ProcessDeps } from "../core/ports";

export function asksRoutes(_d: ProcessDeps): Hono<AuthVars> {
  return new Hono<AuthVars>();
}
