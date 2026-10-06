// HUB-FR-60 · HUB-FR-64 · HUB-FR-69 · H4a-R03, R06, R09, R11 · plan §3 · `GET/POST /studio/api/agents`,
// `GET/PUT/DELETE /studio/api/agents/:id`, `PATCH /studio/api/agents/:id/enabled`.
// Không logic: role đã chặn ở `app.h4a.ts` (403 trước parse) → parse zod (400) / id không uuid (404) → service.
// PUT: runtime bất biến (QB5) ⇒ đọc runtime hàng DB (404 nếu vắng) rồi parse bằng `agentUpdateSchemaFor(runtime)`.
import {
  AgentCreateSchema,
  AgentDeleteQuerySchema,
  AgentEnabledSchema,
  AgentListQuerySchema,
  agentUpdateSchemaFor,
} from "@ai/contracts/studio";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseAdminQuery, parseIdParam, parseJson, parseWith, readJson } from "../../../lib/http";
import type { AgentsService, AgentUpdateBody } from "./agents.service";

export function agentRoutes(svc: AgentsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/agents", async (c) => c.json(await svc.list(parseAdminQuery(c, AgentListQuerySchema))));
  r.post("/agents", async (c) =>
    c.json(await svc.create(c.var.user, await parseJson(c, AgentCreateSchema)), 201),
  );
  r.get("/agents/:id", async (c) => c.json(await svc.get(parseIdParam(c))));
  r.put("/agents/:id", async (c) => {
    const id = parseIdParam(c);
    const schema = agentUpdateSchemaFor(await svc.runtimeOf(id));
    const body = parseWith(schema, await readJson(c)) as AgentUpdateBody;
    return c.json(await svc.update(c.var.user, id, body));
  });
  r.patch("/agents/:id/enabled", async (c) => {
    const id = parseIdParam(c);
    return c.json(await svc.setEnabled(c.var.user, id, await parseJson(c, AgentEnabledSchema)));
  });
  r.delete("/agents/:id", async (c) => {
    const id = parseIdParam(c);
    const { version } = parseAdminQuery(c, AgentDeleteQuerySchema);
    await svc.remove(c.var.user, id, version);
    return c.body(null, 204);
  });
  return r;
}
