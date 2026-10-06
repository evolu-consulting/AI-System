// HUB-FR-62 · H4a-R07, R09 · plan §3 · `/studio/api/orchestrator*`. Không logic: role đã chặn ở `app.h4a.ts` (403 trước
// parse) → parse zod (400) / `tenant_id` không uuid (404) → service. `tenant_id` của POST là trường body (schema), không
// qua `parseQuery` (bỏ khoá phạm vi). DELETE default luôn 409 (R07), không parse gì.
import {
  OrchestratorDeleteQuerySchema,
  OrchestratorPutSchema,
  OrchestratorTenantCreateSchema,
} from "@ai/contracts/studio";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { parseAdminQuery, parseIdParam, parseJson } from "../../../lib/http";
import type { OrchestratorService } from "./orchestrator.service";

export function orchestratorRoutes(svc: OrchestratorService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/orchestrator", async (c) => c.json(await svc.list()));
  r.put("/orchestrator/default", async (c) =>
    c.json(await svc.putDefault(c.var.user, await parseJson(c, OrchestratorPutSchema))),
  );
  r.delete("/orchestrator/default", () => {
    throw appError("ORCHESTRATOR_DEFAULT_PROTECTED");
  });
  r.post("/orchestrator/tenants", async (c) =>
    c.json(
      await svc.createTenant(c.var.user, await parseJson(c, OrchestratorTenantCreateSchema)),
      201,
    ),
  );
  r.put("/orchestrator/tenants/:tenant_id", async (c) => {
    const tenantId = parseIdParam(c, "tenant_id");
    return c.json(
      await svc.putTenant(c.var.user, tenantId, await parseJson(c, OrchestratorPutSchema)),
    );
  });
  r.delete("/orchestrator/tenants/:tenant_id", async (c) => {
    const tenantId = parseIdParam(c, "tenant_id");
    const { version } = parseAdminQuery(c, OrchestratorDeleteQuerySchema);
    await svc.deleteTenant(c.var.user, tenantId, version);
    return c.body(null, 204);
  });
  return r;
}
