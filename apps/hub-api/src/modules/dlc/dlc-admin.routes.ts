// DLC-R14 · DLC-R15 · Evolu Control: `GET /dlc/catalog` · `GET|POST /dlc/workflows` · `PATCH|DELETE /dlc/workflows/:id`.
// Thứ tự kiểm: auth (401, gốc) → role (403: đọc = admin, ghi = platform_admin; trước mọi parse/DB) → path uuid (404) →
// body (400). Không logic.
import { DlcWorkflowCreateSchema, DlcWorkflowPatchSchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole, requirePlatformAdmin } from "../../lib/admin-role.middleware";
import type { AuthVars } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { parseIdParam, parseJson } from "../../lib/http";
import type { DlcEngine } from "./dlc.engine";
import { dlcAdminService } from "./dlc-admin.service";

export function dlcAdminRoutes(db: Db, engine?: DlcEngine): Hono<AuthVars> {
  const svc = dlcAdminService(db, engine);
  const r = new Hono<AuthVars>();
  const admin = requireAdminRole();
  const platform = requirePlatformAdmin();
  r.get("/catalog", admin, async (c) => c.json(await svc.catalog()));
  r.get("/workflows", admin, async (c) => c.json(await svc.list()));
  r.post("/workflows", platform, async (c) =>
    c.json(await svc.create(await parseJson(c, DlcWorkflowCreateSchema)), 201),
  );
  r.patch("/workflows/:id", platform, async (c) => {
    const id = parseIdParam(c);
    return c.json(await svc.update(id, await parseJson(c, DlcWorkflowPatchSchema)));
  });
  r.delete("/workflows/:id", platform, async (c) => {
    await svc.remove(parseIdParam(c));
    return c.body(null, 204);
  });
  return r;
}
