// HUB-FR-120 · ADM-FR-68 · PB-R21 · `/admin/sources*` (tenant_admin; local_path chỉ platform_admin) + `/process-runs/sources`
// (chip user thường). Không logic: role → parse query/body → service. Mọi phản hồi theo contract.
import {
  LibraryDocListQuerySchema,
  SourceCreateRequestSchema,
  SourceDeleteQuerySchema,
  SourceListQuerySchema,
  SourceTenantQuerySchema,
  SourceUpdateRequestSchema,
} from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole } from "../../lib/admin-role.middleware";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseAdminQuery, parseJson } from "../../lib/http";
import type { SourceCheckService } from "./check.service";
import type { SourcesService } from "./sources.service";

export function sourcesRoutes(svc: SourcesService, check: SourceCheckService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  // Chip cho user thường (member) — KHÔNG requireAdminRole; auth gắn ở prefix `/process-runs` (app.ts).
  // C4 · contract ProcessSourceChipListResponseSchema = { items }: trả bao `{items}`, không mảng trần.
  r.get("/process-runs/sources", async (c) => c.json({ items: await svc.chips(c.var.user) }));

  r.use("/admin/sources", requireAdminRole());
  r.use("/admin/sources/*", requireAdminRole());
  r.get("/admin/sources", async (c) => {
    const q = parseAdminQuery(c, SourceListQuerySchema);
    return c.json(await svc.list(c.var.user, q));
  });
  r.post("/admin/sources", async (c) => {
    const b = await parseJson(c, SourceCreateRequestSchema);
    return c.json(await svc.create(c.var.user, b), 201);
  });
  // C3 · ĐĂNG KÝ TRƯỚC `/:key` (nếu không `:key` nuốt "library-documents").
  r.get("/admin/sources/library-documents", async (c) => {
    const q = parseAdminQuery(c, LibraryDocListQuerySchema);
    return c.json(await svc.libraryDocs(c.var.user, q));
  });
  r.get("/admin/sources/:key", async (c) => {
    const q = parseAdminQuery(c, SourceTenantQuerySchema);
    return c.json(await svc.get(c.var.user, c.req.param("key"), q.tenant_id));
  });
  r.put("/admin/sources/:key", async (c) => {
    const q = parseAdminQuery(c, SourceTenantQuerySchema);
    const b = await parseJson(c, SourceUpdateRequestSchema);
    return c.json(await svc.update(c.var.user, c.req.param("key"), q.tenant_id, b));
  });
  r.delete("/admin/sources/:key", async (c) => {
    const q = parseAdminQuery(c, SourceDeleteQuerySchema);
    await svc.remove(c.var.user, c.req.param("key"), q.tenant_id, q.version);
    return c.body(null, 204);
  });
  r.post("/admin/sources/:key/check", async (c) => {
    const q = parseAdminQuery(c, SourceTenantQuerySchema);
    return c.json(await check.check(c.var.user, c.req.param("key"), q.tenant_id));
  });
  return r;
}
