// ADM-FR-40 · /admin/tenants/:id/quotas (plan-contract §2.1). GET: platform_admin; tenant_admin chỉ tenant mình (tenant
// khác → 404 như không tồn tại, RLS là lớp thứ hai). PUT: chỉ platform_admin. Mount TRƯỚC tenantsRoutes (chỉ-platform).
import { QuotaSetRequestSchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { parseIdParam, parseJson } from "../../lib/http";
import { getQuotas, putQuotas, type QuotasCall, type QuotasCtx } from "./quotas.service";

const PATH = "/:id/quotas";

export function quotasRoutes(d: AuthDeps & QuotasCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): QuotasCall => ({
    ctx: d,
    scope: c.get("scope"),
    actor: c.get("actor"),
  });
  r.get(PATH, requireAuth(d), requireRole("platform_admin", "tenant_admin"), async (c) => {
    const id = parseIdParam(c);
    const a = c.get("actor");
    if (a.role === "tenant_admin" && a.tenantId !== id) throw appError("NOT_FOUND");
    return c.json(await getQuotas(call(c), id));
  });
  r.put(PATH, requireAuth(d), requireRole("platform_admin"), async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, QuotaSetRequestSchema);
    return c.json(await putQuotas(call(c), id, input));
  });
  return r;
}
