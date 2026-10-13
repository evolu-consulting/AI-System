// HUB-FR-66 · spec H4b2 §3 A · plan §3.1 · `GET/PUT/DELETE /studio/api/providers/:id`, `POST /studio/api/providers`,
// `PATCH /studio/api/providers/:id/enabled`, `POST /studio/api/providers/:id/check` (B4, không body). `GET /providers` (list) giữ ở `studio.routes.ts` (H4a, D4).
// Không logic: role đã chặn ở `app.h4a.ts` (403 trước parse) → `:id` không uuid ⇒ 400 (cả path con chưa mount, vd
// `/check` của B4) → parse zod (400) → service.
import {
  ProviderCreateSchema,
  ProviderEnabledPatchSchema,
  ProviderUpdateSchema,
  VersionQuerySchema,
} from "@ai/contracts/studio";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseAdminQuery, parseJson } from "../../../lib/http";
import { parseUuidParam, uuidParams } from "../studio-params";
import type { ProviderCheckService } from "./provider-check";
import type { ProvidersService } from "./providers.service";

export function providerRoutes(
  svc: ProvidersService,
  checker: Pick<ProviderCheckService, "check">,
): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use("/providers/:id", uuidParams("id"));
  r.use("/providers/:id/*", uuidParams("id"));
  r.post("/providers", async (c) =>
    c.json(await svc.create(c.var.user, await parseJson(c, ProviderCreateSchema)), 201),
  );
  r.get("/providers/:id", async (c) => c.json(await svc.get(parseUuidParam(c))));
  r.put("/providers/:id", async (c) => {
    const id = parseUuidParam(c);
    return c.json(await svc.update(c.var.user, id, await parseJson(c, ProviderUpdateSchema)));
  });
  r.patch("/providers/:id/enabled", async (c) => {
    const id = parseUuidParam(c);
    const b = await parseJson(c, ProviderEnabledPatchSchema);
    return c.json(await svc.setEnabled(c.var.user, id, b));
  });
  r.delete("/providers/:id", async (c) => {
    const id = parseUuidParam(c);
    const { version } = parseAdminQuery(c, VersionQuerySchema);
    await svc.remove(c.var.user, id, version);
    return c.body(null, 204);
  });
  r.post("/providers/:id/check", async (c) =>
    c.json(await checker.check(c.var.user, parseUuidParam(c))),
  );
  return r;
}
