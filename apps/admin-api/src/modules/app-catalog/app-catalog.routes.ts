// app-catalog · `/admin/apps*` (chỉ platform_admin) và `GET /me/apps` (mọi user đăng nhập, đã lọc theo quyền).
import {
  AppCreateRequestSchema,
  AppKeySchema,
  AppUpdateRequestSchema,
  DefaultAppRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { parseJson } from "../../lib/http";
import {
  type AppCatalogCtx,
  createApp,
  deleteApp,
  listApps,
  myApps,
  updateApp,
} from "./app-catalog.service";
import { getPortal, setMyDefaultApp, setTenantDefaultApp } from "./portal.service";
import { getTenantDefaultApp, setTenantDefaultAppFor } from "./tenant-default-app.service";

export function appCatalogRoutes(d: AuthDeps & AppCatalogCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d), requireRole("platform_admin"));
  const key = (c: Context<AppVars>): string => {
    const k = AppKeySchema.safeParse(c.req.param("key"));
    if (!k.success) throw appError("NOT_FOUND");
    return k.data;
  };
  r.get("/", async (c) => c.json(await listApps(d, c.get("actor"))));
  r.post("/", async (c) =>
    c.json(await createApp(d, c.get("actor"), await parseJson(c, AppCreateRequestSchema)), 201),
  );
  r.patch("/:key", async (c) =>
    c.json(await updateApp(d, c.get("actor"), key(c), await parseJson(c, AppUpdateRequestSchema))),
  );
  r.delete("/:key", async (c) => {
    await deleteApp(d, c.get("actor"), key(c));
    return c.body(null, 204);
  });
  return r;
}

/** `/admin/tenants/:id/default-app` (chỉ platform_admin) — mount cạnh các route `/admin/tenants` khác. */
export function tenantDefaultAppRoutes(d: AuthDeps & AppCatalogCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const id = (c: Context<AppVars>): string => {
    const k = z.uuid().safeParse(c.req.param("id"));
    if (!k.success) throw appError("NOT_FOUND");
    return k.data;
  };
  const guard = [requireAuth(d), requireRole("platform_admin")] as const;
  r.get("/:id/default-app", ...guard, async (c) =>
    c.json(await getTenantDefaultApp(d, c.get("actor"), id(c))),
  );
  r.put("/:id/default-app", ...guard, async (c) =>
    c.json(
      await setTenantDefaultAppFor(
        d,
        c.get("actor"),
        id(c),
        await parseJson(c, DefaultAppRequestSchema),
      ),
    ),
  );
  return r;
}

export function meAppsRoutes(d: AuthDeps & AppCatalogCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d));
  r.get("/apps", async (c) => c.json(await myApps(d, c.get("actor"))));
  // portal-home: app mặc định khi đăng nhập + số cho thẻ Quản trị.
  r.get("/portal", async (c) => c.json(await getPortal(d, c.get("actor"))));
  r.put("/default-app", async (c) =>
    c.json(await setMyDefaultApp(d, c.get("actor"), await parseJson(c, DefaultAppRequestSchema))),
  );
  r.put("/tenant-default-app", async (c) =>
    c.json(
      await setTenantDefaultApp(d, c.get("actor"), await parseJson(c, DefaultAppRequestSchema)),
    ),
  );
  return r;
}
