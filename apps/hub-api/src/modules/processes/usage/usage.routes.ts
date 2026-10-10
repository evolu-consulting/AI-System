// HUB-FR-116 · HUB-FR-117 · PF4 · `GET /process-runs/:id/usage` (plan §6, §9; plan-contract §3). Auth gắn ở `app.ts`
// (`/process-runs` ∈ PROTECTED_PREFIXES); cờ tắt ⇒ module không mount ⇒ 404. Không logic: parse id + `?tenant_id` → service.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { UsageService } from "./usage.service";

export function usageRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new UsageService(d);
  const r = new Hono<AuthVars>();
  r.get("/process-runs/:id/usage", async (c) => {
    const id = parseIdParam(c);
    return c.json(await svc.get(c.var.user, id, c.req.query("tenant_id")));
  });
  return r;
}
