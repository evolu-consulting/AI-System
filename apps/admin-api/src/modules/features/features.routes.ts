// ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34 · /admin/features* + entitlement (spec M2 §3). Chỉ platform_admin.
import {
  FeatureCreateRequestSchema,
  FeatureListQuerySchema,
  FeatureUpdateRequestSchema,
  ListQueryBase,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import { grantEntitlement, listEntitlements, revokeEntitlement } from "./features.entitlements";
import {
  type Call,
  createFeature,
  deleteFeature,
  type FeaturesCtx,
  getFeature,
  listFeatures,
  updateFeature,
} from "./features.service";

export function featuresRoutes(d: AuthDeps & FeaturesCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  const ids = (c: Context<AppVars>) => [parseIdParam(c), parseIdParam(c, "tenant_id")] as const;
  r.use("*", requireAuth(d), requireRole("platform_admin"));

  r.get("/", async (c) =>
    c.json(await listFeatures(call(c), parseQuery(c, FeatureListQuerySchema))),
  );
  r.post("/", async (c) => {
    const input = await parseJson(c, FeatureCreateRequestSchema);
    return c.json(await createFeature(call(c), input), 201);
  });
  r.get("/:id", async (c) => c.json(await getFeature(call(c), parseIdParam(c))));
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, FeatureUpdateRequestSchema);
    return c.json(await updateFeature(call(c), id, input));
  });
  r.delete("/:id", async (c) => {
    await deleteFeature(call(c), parseIdParam(c));
    return c.body(null, 204);
  });
  r.get("/:id/entitlements", async (c) => {
    const id = parseIdParam(c);
    return c.json(await listEntitlements(call(c), id, parseQuery(c, ListQueryBase)));
  });
  r.put("/:id/entitlements/:tenant_id", async (c) => {
    const [id, tenantId] = ids(c);
    return c.json(await grantEntitlement(call(c), id, tenantId));
  });
  r.delete("/:id/entitlements/:tenant_id", async (c) => {
    const [id, tenantId] = ids(c);
    await revokeEntitlement(call(c), id, tenantId);
    return c.body(null, 204);
  });
  return r;
}
