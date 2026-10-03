// ADM-FR-42, ADM-BR-09 · /admin/usage, /admin/usage.csv (plan-contract §2.2). platform_admin + tenant_admin; member → 403
// trước khi parse. tenant_admin: tenant khác → 404.
import { UsageQuerySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseQuery } from "../../lib/http";
import { getUsage, getUsageCsv, type UsageCall, type UsageCtx } from "./usage.service";

export function usageRoutes(d: AuthDeps & UsageCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): UsageCall => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  // Mount ở "/admin": middleware theo route (không `use("*")`, sẽ phủ cả /admin/*).
  const guard = [requireAuth(d), requireRole("platform_admin", "tenant_admin")] as const;

  r.get("/usage", ...guard, async (c) =>
    c.json(await getUsage(call(c), parseQuery(c, UsageQuerySchema))),
  );
  r.get("/usage.csv", ...guard, async (c) => {
    const out = await getUsageCsv(call(c), parseQuery(c, UsageQuerySchema));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${out.filename}"`);
    return c.body(out.body);
  });
  return r;
}
