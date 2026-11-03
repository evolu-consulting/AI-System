// ADM-FR-60, ADM-FR-61, ADM-FR-81 · /admin/tenants* (spec M1 §3). Danh sách/tạo/sửa/khoá: chỉ platform_admin.
// CR-112: GET /:id mở cho tenant_admin — chỉ tenant mình (cổng `tenantWorkspaceGate` ở app.ts; tenant khác ⇒ 404).
// Guard gắn theo từng route (không `*`) để không chặn router `/admin/tenants` mount sau.
import {
  TenantCreateRequestSchema,
  TenantListQuerySchema,
  TenantUpdateRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import { requireTenantScope } from "../../lib/tenant-scope";
import type { TestHooks } from "../../lib/test-hooks";
import {
  createTenant,
  getTenant,
  listTenants,
  setTenantLocked,
  type TenantsCall,
  updateTenant,
} from "./tenants.service";

export function tenantsRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const platform = [requireAuth(d), requireRole("platform_admin")] as const;
  const admins = [requireAuth(d), requireRole("platform_admin", "tenant_admin")] as const;
  const call = (c: Context<AppVars>): TenantsCall => ({
    ctx: d,
    scope: c.get("scope"),
    actor: c.get("actor"),
  });

  r.get("/", ...platform, async (c) =>
    c.json(await listTenants(d, c.get("scope"), parseQuery(c, TenantListQuerySchema))),
  );
  r.post("/", ...platform, async (c) => {
    const input = await parseJson(c, TenantCreateRequestSchema);
    return c.json(await createTenant(call(c), input), 201);
  });
  r.get("/:id", ...admins, async (c) => {
    const id = parseIdParam(c);
    requireTenantScope(c, id);
    return c.json(await getTenant(d, c.get("scope"), id));
  });
  r.patch("/:id", ...platform, async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, TenantUpdateRequestSchema);
    return c.json(await updateTenant(call(c), id, input));
  });
  r.post("/:id/lock", ...platform, async (c) =>
    c.json(await setTenantLocked(call(c), parseIdParam(c), true)),
  );
  r.post("/:id/unlock", ...platform, async (c) =>
    c.json(await setTenantLocked(call(c), parseIdParam(c), false)),
  );
  return r;
}
