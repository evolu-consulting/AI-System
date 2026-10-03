// ADM-FR-44, ADM-BR-09 · `GET /admin/overview` (plan-contract §2.3). platform_admin + tenant_admin; member → 403.
// tenant_admin còn kích evaluator cảnh báo nền (chặn lặp 60 s/tenant, plan §5.2).
import { Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { type EvaluatorCtx, evaluateThrottled } from "../quotas/quotas.evaluator";
import { getOverview } from "./overview.service";

export function overviewRoutes(d: AuthDeps & EvaluatorCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  // Mount ở "/admin": middleware theo route (không `use("*")`).
  r.get("/overview", requireAuth(d), requireRole("platform_admin", "tenant_admin"), async (c) => {
    const actor = c.get("actor");
    const out = await getOverview({ ctx: d, actor, scope: c.get("scope") });
    if (actor.role === "tenant_admin") evaluateThrottled(d, actor.tenantId);
    return c.json(out);
  });
  return r;
}
