// HUB-FR-104 · HUB-FR-114 · ADM-FR-65 · ADM-FR-67 · B3 (0c) · `/process-defs*`, `GET /agent-teams` (plan-contract §6). Không logic:
// role (403 trước parse) → parse query/body (400) → phạm vi tenant MỘT lần (`defScopeOf`) → service.
import {
  CopyProcessDefRequestSchema,
  DeleteProcessDefQuerySchema,
  ProcessDefInputBaseSchema,
  ProcessDefListQuerySchema,
  ProcessDefTenantQuerySchema,
  RunProcessDefRequestSchema,
  UpdateProcessDefRequestSchema,
} from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole } from "../../../lib/admin-role.middleware";
import type { AuthUser, AuthVars } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { parseAdminQuery, parseIdParam, parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { type DefScope, defScopeOf } from "./def.rules";

import { DefsService } from "./defs.service";

function scopeOf(user: AuthUser, queryTenantId: string | undefined): DefScope {
  const s = defScopeOf(user, queryTenantId);
  if (!s.ok) throw appError(s.code);
  return { tenantId: s.tenantId };
}

export function defsRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new DefsService(d);
  const r = new Hono<AuthVars>();
  r.use("/process-defs", requireAdminRole());
  r.use("/process-defs/*", requireAdminRole());
  r.use("/agent-teams", requireAdminRole());
  r.get("/process-defs", async (c) => {
    const q = parseAdminQuery(c, ProcessDefListQuerySchema);
    return c.json(await svc.list(scopeOf(c.var.user, q.tenant_id), q));
  });
  r.get("/process-defs/:id", async (c) => {
    const q = parseAdminQuery(c, ProcessDefTenantQuerySchema);
    return c.json(await svc.get(scopeOf(c.var.user, q.tenant_id), parseIdParam(c)));
  });
  r.post("/process-defs", async (c) => {
    const q = parseAdminQuery(c, ProcessDefTenantQuerySchema);
    const b = await parseJson(c, ProcessDefInputBaseSchema);
    return c.json(await svc.create(c.var.user, scopeOf(c.var.user, q.tenant_id), b), 201);
  });
  r.post("/process-defs/:id/copy", async (c) => {
    const q = parseAdminQuery(c, ProcessDefTenantQuerySchema);
    const id = parseIdParam(c);
    const b = await parseJson(c, CopyProcessDefRequestSchema);
    return c.json(await svc.copy(c.var.user, scopeOf(c.var.user, q.tenant_id), id, b), 201);
  });
  r.put("/process-defs/:id", async (c) => {
    const q = parseAdminQuery(c, ProcessDefTenantQuerySchema);
    const id = parseIdParam(c);
    const b = await parseJson(c, UpdateProcessDefRequestSchema);
    return c.json(await svc.update(c.var.user, scopeOf(c.var.user, q.tenant_id), id, b));
  });
  r.delete("/process-defs/:id", async (c) => {
    const q = parseAdminQuery(c, DeleteProcessDefQuerySchema);
    const id = parseIdParam(c);
    await svc.remove(c.var.user, scopeOf(c.var.user, q.tenant_id), id, q.version);
    return c.body(null, 204);
  });
  r.post("/process-defs/:id/run", async (c) => {
    const q = parseAdminQuery(c, ProcessDefTenantQuerySchema);
    const id = parseIdParam(c);
    const b = await parseJson(c, RunProcessDefRequestSchema);
    return c.json(await svc.run(c.var.user, scopeOf(c.var.user, q.tenant_id), id, b.input), 201);
  });
  r.get("/agent-teams", async (c) => {
    const q = parseAdminQuery(c, ProcessDefTenantQuerySchema);
    return c.json(await svc.teams(scopeOf(c.var.user, q.tenant_id)));
  });
  return r;
}
