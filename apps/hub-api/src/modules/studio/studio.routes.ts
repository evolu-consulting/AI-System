// HUB-FR-72 · HUB-FR-90 · H4a-R01, R02, R13 · plan §3 · `GET /studio/api/{me,agent-types,model-profiles,providers,
// workflows,tenants}`. Không logic: role đã chặn ở `app.h4a.ts` (403 trước parse) → parse query (400) → service.
import { CatalogQuerySchema, WorkflowCatalogQuerySchema } from "@ai/contracts/studio";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseAdminQuery } from "../../lib/http";
import type { StudioReadService } from "./studio-read.service";

/** Query catalog strict (khoá lạ ⇒ 400) — giữ nguyên `tenant_id` nếu có để strict báo lỗi thay vì lặng lẽ bỏ. */
export function studioReadRoutes(svc: StudioReadService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/me", async (c) => c.json(await svc.me(c.var.user)));
  r.get("/agent-types", async (c) =>
    c.json(await svc.agentTypes(parseAdminQuery(c, CatalogQuerySchema))),
  );
  r.get("/model-profiles", async (c) =>
    c.json(await svc.modelProfiles(parseAdminQuery(c, CatalogQuerySchema))),
  );
  r.get("/providers", async (c) =>
    c.json(await svc.providers(parseAdminQuery(c, CatalogQuerySchema))),
  );
  r.get("/workflows", async (c) =>
    c.json(await svc.workflows(parseAdminQuery(c, WorkflowCatalogQuerySchema))),
  );
  r.get("/tenants", async (c) => c.json(await svc.tenants(parseAdminQuery(c, CatalogQuerySchema))));
  return r;
}
