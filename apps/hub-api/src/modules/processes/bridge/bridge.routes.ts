// CR-122 · N2 · FLOW2-FR-26 · `POST /process-defs/bridge-suggest?tenant_id=` — gợi ý chèn node Ghi giá trị làm cầu nối (AI qua Agent Hub).
// Không logic: role admin (403) → parse body (400) → phạm vi tenant (`defScopeOf`) → service. Không lưu gì.
import { BridgeSuggestRequestSchema, ProcessDefTenantQuerySchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole } from "../../../lib/admin-role.middleware";
import type { AuthVars } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { parseAdminQuery, parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { defScopeOf } from "../defs/def.rules";
import { BridgeService } from "./bridge.service";

export function bridgeRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new BridgeService({ config: d.config, agent: d.bridgeAgent });
  const r = new Hono<AuthVars>();
  r.use("/process-defs/bridge-suggest", requireAdminRole());
  r.post("/process-defs/bridge-suggest", async (c) => {
    const q = parseAdminQuery(c, ProcessDefTenantQuerySchema);
    const body = await parseJson(c, BridgeSuggestRequestSchema);
    const s = defScopeOf(c.var.user, q.tenant_id);
    if (!s.ok) throw appError(s.code);
    return c.json(await svc.suggest(c.var.user, s.tenantId, body));
  });
  return r;
}
