// PK-FR-05 · D-05 · N1 plan §2 (readiness #1, #7): `/admin/tenants/:tenant_id/packs[/:pack_key]`, chỉ platform_admin (không
// token ⇒ 401, sai vai ⇒ 403). Khoá sai dạng/bị cấm ⇒ 400 VALIDATION_ERROR (trước khi chạm DB); tenant_id không phải uuid ⇒ 404.
import { PackKeySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseWith } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import { disablePack, enablePack, listPacks, type PacksCall } from "./packs.service";

export function packsRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d), requireRole("platform_admin"));
  const call = (c: Context<AppVars>): PacksCall => ({
    ctx: d,
    scope: c.get("scope"),
    actor: c.get("actor"),
  });
  const ids = (c: Context<AppVars>) => {
    const k = parseWith(PackKeySchema, c.req.param("pack_key"));
    return [parseIdParam(c, "tenant_id"), k] as const;
  };

  r.get("/:tenant_id/packs", async (c) =>
    c.json(await listPacks(call(c), parseIdParam(c, "tenant_id"))),
  );
  r.put("/:tenant_id/packs/:pack_key", async (c) => {
    const [tenantId, k] = ids(c);
    return c.json(await enablePack(call(c), tenantId, k));
  });
  r.delete("/:tenant_id/packs/:pack_key", async (c) => {
    const [tenantId, k] = ids(c);
    await disablePack(call(c), tenantId, k);
    return c.body(null, 204);
  });
  return r;
}
