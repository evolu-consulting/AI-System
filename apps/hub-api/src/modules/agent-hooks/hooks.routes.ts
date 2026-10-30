// dlc-dify · route Studio `PUT /agents/:id/hooks` (gắn dưới `/studio/api`, sau `requirePlatformAdmin` của app.h4a.ts ⇒ 403
// trước parse). Không logic: id không uuid (404) → parse zod (400) → service.
import { AgentHooksRequestSchema } from "@ai/contracts/studio";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseIdParam, parseJson } from "../../lib/http";
import type { AgentHooksService } from "./hooks.service";

export function agentHooksRoutes(svc: AgentHooksService) {
  const r = new Hono<AuthVars>();
  r.put("/agents/:id/hooks", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, AgentHooksRequestSchema);
    return c.json(await svc.setHooks(c.var.user, id, b));
  });
  return r;
}
