// ADM-FR-60, ADM-FR-61 · /admin/tenants* (spec M1 §3). Chỉ platform_admin; kiểm role trước khi tra thực thể.
import {
  TenantCreateRequestSchema,
  TenantListQuerySchema,
  TenantUpdateRequestSchema,
} from "@ai/contracts";
import { Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import {
  createTenant,
  getTenant,
  listTenants,
  setTenantLocked,
  updateTenant,
} from "./tenants.service";

export function tenantsRoutes(d: AuthDeps): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d), requireRole("platform_admin"));

  r.get("/", async (c) =>
    c.json(await listTenants(d, c.get("scope"), parseQuery(c, TenantListQuerySchema))),
  );
  r.post("/", async (c) => {
    const input = await parseJson(c, TenantCreateRequestSchema);
    return c.json(await createTenant(d, c.get("scope"), input), 201);
  });
  r.get("/:id", async (c) => c.json(await getTenant(d, c.get("scope"), parseIdParam(c))));
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, TenantUpdateRequestSchema);
    return c.json(await updateTenant(d, c.get("scope"), id, input));
  });
  r.post("/:id/lock", async (c) =>
    c.json(await setTenantLocked(d, c.get("scope"), parseIdParam(c), true)),
  );
  r.post("/:id/unlock", async (c) =>
    c.json(await setTenantLocked(d, c.get("scope"), parseIdParam(c), false)),
  );
  return r;
}
