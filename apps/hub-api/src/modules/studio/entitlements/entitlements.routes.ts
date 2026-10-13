// HUB-FR-77 · HUB-FR-78 · spec H4b2 §3 C · `GET /studio/api/agent-entitlements` (ma trận),
// `GET|PUT|DELETE /studio/api/agent-entitlements/:agent_id/:tenant_id` (ô: drawer · cấp · thu hồi). Không logic: role đã chặn
// ở `app.h4a.ts` (403 trước parse) → param không uuid ⇒ 400 → service.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseUuidParam, uuidParams } from "../studio-params";
import type { EntitlementsService } from "./entitlements.service";

const CELL = "/agent-entitlements/:agent_id/:tenant_id";

export function entitlementRoutes(svc: EntitlementsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use(CELL, uuidParams("agent_id", "tenant_id"));
  r.get("/agent-entitlements", async (c) => c.json(await svc.matrix()));
  r.get(CELL, async (c) =>
    c.json(await svc.cell(parseUuidParam(c, "agent_id"), parseUuidParam(c, "tenant_id"))),
  );
  r.put(CELL, async (c) =>
    c.json(
      await svc.set(
        c.var.user,
        parseUuidParam(c, "agent_id"),
        parseUuidParam(c, "tenant_id"),
        true,
      ),
    ),
  );
  r.delete(CELL, async (c) =>
    c.json(
      await svc.set(
        c.var.user,
        parseUuidParam(c, "agent_id"),
        parseUuidParam(c, "tenant_id"),
        false,
      ),
    ),
  );
  return r;
}
