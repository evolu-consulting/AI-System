// HUB-FR-131 · spec K1 §3.2 · route Studio `/kh/connections*` (gắn dưới `/studio/api`, sau `requirePlatformAdmin` của
// app.h4a.ts ⇒ 403 trước parse). Không logic: parse zod (400) / id không uuid (404) → service.
import {
  KhConnectionDeleteQuerySchema,
  KhConnectionListQuerySchema,
  KhConnectionUpdateSchema,
  KhConnectionWriteSchema,
} from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseAdminQuery, parseIdParam, parseJson } from "../../lib/http";
import type { KhCheckService } from "./kh.check.service";
import type { KhStudioService } from "./kh.studio.service";

export const KH_CONNECTIONS = "/kh/connections";

export function khStudioRoutes(svc: KhStudioService, checker: KhCheckService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  const C = KH_CONNECTIONS;
  r.get(C, async (c) => c.json(await svc.list(parseAdminQuery(c, KhConnectionListQuerySchema))));
  r.post(C, async (c) => {
    const b = await parseJson(c, KhConnectionWriteSchema);
    return c.json(await svc.create(c.var.user, b), 201);
  });
  r.put(`${C}/:id`, async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, KhConnectionUpdateSchema);
    return c.json(await svc.update(c.var.user, id, b));
  });
  r.delete(`${C}/:id`, async (c) => {
    const id = parseIdParam(c);
    const { version } = parseAdminQuery(c, KhConnectionDeleteQuerySchema);
    await svc.remove(c.var.user, id, version);
    return c.body(null, 204);
  });
  r.post(`${C}/:id/check`, async (c) => c.json(await checker.check(c.var.user, parseIdParam(c))));
  return r;
}
