// ADM-FR-32, ADM-FR-35, ADM-BR-05, ADM-BR-09 · /admin/grants* (spec M3 §3). platform_admin + tenant_admin; member → 403
// trước khi parse/tra.
import {
  GrantBatchRequestSchema,
  GrantCreateRequestSchema,
  GrantDeleteQuerySchema,
  GrantListQuerySchema,
  GrantMatrixQuerySchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseJson, parseQuery } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import { batchGrants } from "./grants.batch";
import { grantMatrix } from "./grants.matrix";
import { type Call, createGrant, deleteGrant, listGrants } from "./grants.service";

const TenantIdQuery = GrantListQuerySchema.pick({ tenant_id: true });

export function grantsRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin", "tenant_admin"));

  r.get("/", async (c) => c.json(await listGrants(call(c), parseQuery(c, GrantListQuerySchema))));
  r.get("/matrix", async (c) =>
    c.json(await grantMatrix(call(c), parseQuery(c, GrantMatrixQuerySchema))),
  );
  r.post("/", async (c) => {
    const { tenant_id } = parseQuery(c, TenantIdQuery);
    const input = await parseJson(c, GrantCreateRequestSchema);
    const { grant, created } = await createGrant(call(c), tenant_id, input);
    return c.json(grant, created ? 201 : 200);
  });
  r.delete("/", async (c) => {
    await deleteGrant(call(c), parseQuery(c, GrantDeleteQuerySchema));
    return c.body(null, 204);
  });
  r.put("/batch", async (c) => {
    const { tenant_id } = parseQuery(c, TenantIdQuery);
    const input = await parseJson(c, GrantBatchRequestSchema);
    return c.json(await batchGrants(call(c), tenant_id, input));
  });
  return r;
}
