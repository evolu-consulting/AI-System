// HUB-FR-78 · ADM-FR-37 · H3b-R01, R02, R04, R07, R11 · GET/POST/DELETE `/agent-grants` (plan H3b §3). Không logic:
// role (403 trước parse, `requireAdminRole`) → parse query/body (400) → tenant đích MỘT lần (`targetTenant`) → service.
import {
  AgentGrantCreateSchema,
  AgentGrantDeleteQuerySchema,
  AgentGrantListQuerySchema,
  AgentGrantTenantQuerySchema,
} from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole } from "../../lib/admin-role.middleware";
import type { AuthUser, AuthVars } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { parseAdminQuery, parseWith, readJson } from "../../lib/http";
import { targetTenant } from "./agent-grants.rules";
import type { AgentGrantsService } from "./agent-grants.service";

/** R02 · tenant đích quyết một lần đầu request; mọi câu sau lọc theo giá trị này. */
export function tenantOf(user: AuthUser, queryTenantId: string | undefined): string {
  const t = targetTenant({ role: user.role, tenantId: user.tenantId }, queryTenantId);
  if (!t.ok) throw appError(t.code);
  return t.tenantId;
}

export function agentGrantRoutes(svc: AgentGrantsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  // `*` của router con ⇒ phủ mọi đường dưới `/agent-grants` (kể cả `effective/:user_id`), trước mọi parse.
  r.use("*", requireAdminRole());
  r.get("/", async (c) => {
    const q = parseAdminQuery(c, AgentGrantListQuerySchema);
    const t = tenantOf(c.var.user, q.tenant_id);
    const subject =
      q.subject_type && q.subject_id ? { type: q.subject_type, id: q.subject_id } : null;
    return c.json(await svc.list(c.var.user, t, subject));
  });
  r.post("/", async (c) => {
    // R04: body hợp lệ TRƯỚC tenant đích (G2: tenant sai + body sai ⇒ 400 VALIDATION_ERROR).
    const q = parseAdminQuery(c, AgentGrantTenantQuerySchema);
    const b = parseWith(AgentGrantCreateSchema, await readJson(c));
    const t = tenantOf(c.var.user, q.tenant_id);
    const key = { agentId: b.agent_id, subjectType: b.subject_type, subjectId: b.subject_id };
    const res = await svc.grant(c.var.user, t, key);
    return c.json(res.body, res.created ? 201 : 200);
  });
  r.delete("/", async (c) => {
    const q = parseAdminQuery(c, AgentGrantDeleteQuerySchema);
    const t = tenantOf(c.var.user, q.tenant_id);
    const key = { agentId: q.agent_id, subjectType: q.subject_type, subjectId: q.subject_id };
    await svc.revoke(c.var.user, t, key);
    return c.body(null, 204);
  });
  return r;
}
