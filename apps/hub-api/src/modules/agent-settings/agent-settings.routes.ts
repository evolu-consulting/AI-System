// HUB-FR-77 · HUB-FR-78 · CR-054 · `/agent-settings` (Evolu Control → Agents). Không logic: role (403 trước parse) → parse
// query/body (400) → tenant đích một lần (`tenantOf`, như `/agent-grants`) → service.
import {
  AgentDefaultsSchema,
  AgentEntitlementPutSchema,
  AgentGrantTenantQuerySchema,
} from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole } from "../../lib/admin-role.middleware";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseAdminQuery, parseWith, readJson } from "../../lib/http";
import { tenantOf } from "../agent-grants/agent-grants.routes";
import type { AgentSettingsService } from "./agent-settings.service";

export function agentSettingsRoutes(svc: AgentSettingsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use("*", requireAdminRole());
  r.get("/", async (c) => {
    const q = parseAdminQuery(c, AgentGrantTenantQuerySchema);
    return c.json(await svc.list(c.var.user, tenantOf(c.var.user, q.tenant_id)));
  });
  r.put("/default", async (c) => {
    const q = parseAdminQuery(c, AgentGrantTenantQuerySchema);
    const b = parseWith(AgentDefaultsSchema, await readJson(c));
    return c.json(await svc.putDefaults(c.var.user, tenantOf(c.var.user, q.tenant_id), b));
  });
  r.put("/entitlements", async (c) => {
    const q = parseAdminQuery(c, AgentGrantTenantQuerySchema);
    const b = parseWith(AgentEntitlementPutSchema, await readJson(c));
    const t = tenantOf(c.var.user, q.tenant_id);
    return c.json(await svc.putEntitlement(c.var.user, t, b.agent_id, b.entitled));
  });
  return r;
}
