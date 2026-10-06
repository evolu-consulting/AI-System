// HUB-FR-60 · HUB-FR-64 · H4a-R03, R11 · plan §3 · `GET/POST /studio/api/agents`, `GET /studio/api/agents/:id`.
// Không logic: role đã chặn ở `app.h4a.ts` (403 trước parse) → parse zod (400) / id không uuid (404) → service.
import { AgentCreateSchema, AgentListQuerySchema } from "@ai/contracts/studio";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseAdminQuery, parseIdParam, parseJson } from "../../../lib/http";
import type { AgentsService } from "./agents.service";

export function agentRoutes(svc: AgentsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/agents", async (c) => c.json(await svc.list(parseAdminQuery(c, AgentListQuerySchema))));
  r.post("/agents", async (c) =>
    c.json(await svc.create(c.var.user, await parseJson(c, AgentCreateSchema)), 201),
  );
  r.get("/agents/:id", async (c) => c.json(await svc.get(parseIdParam(c))));
  return r;
}
