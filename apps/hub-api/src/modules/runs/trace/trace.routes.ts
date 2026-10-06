// HUB-FR-52 · HUB-FR-87 · H3b-R17, R20 · `GET /runs/:id/trace` (plan H3b §3, §5.4), mount dưới `/runs` cạnh `GET /runs/:id`
// (route chat không đổi — R20). `id` không uuid ⇒ 404 giống hệt run không có. Không logic.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam } from "../../../lib/http";
import type { TraceService } from "./trace.service";

export function traceRoutes(svc: TraceService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/:id/trace", async (c) => c.json(await svc.trace(c.var.user, parseIdParam(c))));
  return r;
}
