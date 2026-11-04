// dlc-step-library · `/dlc-step-templates` (thư viện bước DLC) — MỌI route chỉ platform_admin: 403 trước parse/đọc DB. Không logic.
import { DlcStepTemplateInputSchema, DlcStepTemplateUpdateSchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requirePlatformAdmin } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam, parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { DlcStepsService } from "./dlc-steps.service";

export function dlcStepRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new DlcStepsService(d);
  const r = new Hono<AuthVars>();
  for (const p of ["/dlc-step-templates", "/dlc-step-templates/*"])
    r.use(p, requirePlatformAdmin());
  r.get("/dlc-step-templates", async (c) => c.json(await svc.list()));
  r.post("/dlc-step-templates", async (c) => {
    const b = await parseJson(c, DlcStepTemplateInputSchema);
    return c.json(await svc.create(c.var.user, b), 201);
  });
  r.put("/dlc-step-templates/:id", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, DlcStepTemplateUpdateSchema);
    return c.json(await svc.update(c.var.user, id, b));
  });
  r.delete("/dlc-step-templates/:id", async (c) => {
    await svc.remove(c.var.user, parseIdParam(c));
    return c.body(null, 204);
  });
  return r;
}
