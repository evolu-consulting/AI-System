// HUB-FR-92 · GET `/agents` (plan §2.3): JWT mọi role (401 ở middleware gốc) → menu `@`. Không logic.
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import type { AgentsService } from "./agents.service";

export function agentRoutes(svc: AgentsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/", async (c) => c.json(await svc.menu(c.var.user)));
  return r;
}
