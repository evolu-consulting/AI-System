// ADM-FR-36, ADM-BR-05, ADM-BR-09 · GET /admin/users/:id/effective-access (spec M3 §3). Mount ở `/admin/users` TRƯỚC
// router users; auth gắn theo route (không `use("*")`) để không chạy hai lần cho mọi request /admin/users.
import { EffectiveAccessQuerySchema } from "@ai/contracts";
import { Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseQuery } from "../../lib/http";
import { effectiveAccess } from "./access.service";

export function accessRoutes(d: AuthDeps): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const guard = [requireAuth(d), requireRole("platform_admin", "tenant_admin")] as const;
  r.get("/:id/effective-access", ...guard, async (c) => {
    const id = parseIdParam(c);
    const q = parseQuery(c, EffectiveAccessQuerySchema);
    const call = { ctx: d, actor: c.get("actor"), scope: c.get("scope") };
    return c.json(await effectiveAccess(call, id, q));
  });
  return r;
}
