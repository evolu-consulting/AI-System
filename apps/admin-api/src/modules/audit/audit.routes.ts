// ADM-FR-51, ADM-FR-52, ADM-BR-09 · /admin/audit* (plan-contract §2.4). platform_admin + tenant_admin; member → 403
// trước khi parse/tra. Restore chỉ platform_admin (Q8: tenant_admin 403 trước khi tra).
import { AuditListQuerySchema, AuditRestoreRequestSchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import { type RestoreCtx, restoreAudit } from "./audit.restore";
import { type AuditCtx, type Call, getAudit, listAudit } from "./audit.service";

export function auditRoutes(d: AuthDeps & AuditCtx & RestoreCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin", "tenant_admin"));

  r.get("/", async (c) => c.json(await listAudit(call(c), parseQuery(c, AuditListQuerySchema))));
  r.get("/:id", async (c) => c.json(await getAudit(call(c), parseIdParam(c))));
  // Q8: tenant_admin → 403 trước khi tra; body `{}` strict.
  r.post("/:id/restore", requireRole("platform_admin"), async (c) => {
    const id = parseIdParam(c);
    await parseJson(c, AuditRestoreRequestSchema);
    return c.json(await restoreAudit({ ...call(c), ctx: d }, id));
  });
  return r;
}
