// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · CR-060 · spec H4b-1 §3 A + B · plan D13 · route secrets. Không logic: role (Studio:
// `requirePlatformAdmin` ở app.h4a.ts; tenant: `requireAdminRole`) → parse zod (400) / id không uuid (404) → tenant đích
// (`credentialTenant`) → service. KHÔNG có endpoint đọc giá trị.
import {
  HubSecretCreateRequestSchema,
  HubSecretDeleteQuerySchema,
  HubSecretListQuerySchema,
  HubSecretRotateRequestSchema,
  SourceCredentialCreateRequestSchema,
  SourceCredentialDeleteQuerySchema,
  SourceCredentialListQuerySchema,
  SourceCredentialTenantQuerySchema,
} from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import { requireAdminRole } from "../../lib/admin-role.middleware";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseAdminQuery, parseIdParam, parseJson } from "../../lib/http";
import { credentialTenant } from "./secrets.rules";
import { type SecretsService, studioTarget, tenantTarget } from "./secrets.service";

/** A · gắn dưới `/studio/api` (platform_admin, mọi kind). */
export function secretStudioRoutes(svc: SecretsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  const t = studioTarget;
  r.get("/secrets", async (c) => {
    const q = parseAdminQuery(c, HubSecretListQuerySchema);
    return c.json(await svc.list(t, { ...q, tenantId: q.tenant_id }));
  });
  r.post("/secrets", async (c) => {
    const b = await parseJson(c, HubSecretCreateRequestSchema);
    const input = { kind: b.kind, name: b.name, value: b.value, tenantId: b.tenant_id ?? null };
    return c.json(await svc.create(c.var.user, t, input), 201);
  });
  r.get("/secrets/:id", async (c) => c.json(await svc.get(t, parseIdParam(c))));
  r.put("/secrets/:id", async (c) => {
    const id = parseIdParam(c);
    const b = await parseJson(c, HubSecretRotateRequestSchema);
    return c.json(await svc.rotate(c.var.user, t, id, b));
  });
  r.delete("/secrets/:id", async (c) => {
    const id = parseIdParam(c);
    const { version } = parseAdminQuery(c, HubSecretDeleteQuerySchema);
    await svc.remove(c.var.user, t, id, version);
    return c.body(null, 204);
  });
  return r;
}

export const SOURCE_CREDENTIALS = "/admin/source-credentials";

/** B · tenant_admin (tenant phiên) hoặc platform_admin (kèm `tenant_id`); chỉ `source_credential`. */
export function sourceCredentialRoutes(svc: SecretsService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.use(SOURCE_CREDENTIALS, requireAdminRole());
  r.use(`${SOURCE_CREDENTIALS}/*`, requireAdminRole());
  r.get(SOURCE_CREDENTIALS, async (c) => {
    const q = parseAdminQuery(c, SourceCredentialListQuerySchema);
    const tenantId = credentialTenant(c.var.user, q.tenant_id, "read");
    return c.json(await svc.list(tenantTarget(c.var.user, tenantId), q));
  });
  r.post(SOURCE_CREDENTIALS, async (c) => {
    const b = await parseJson(c, SourceCredentialCreateRequestSchema);
    const tenantId = credentialTenant(c.var.user, b.tenant_id, "write");
    const input = { kind: "source_credential" as const, name: b.name, value: b.value, tenantId };
    return c.json(await svc.create(c.var.user, tenantTarget(c.var.user, tenantId), input), 201);
  });
  r.get(`${SOURCE_CREDENTIALS}/:id`, async (c) => {
    const id = parseIdParam(c);
    const q = parseAdminQuery(c, SourceCredentialTenantQuerySchema);
    const tenantId = credentialTenant(c.var.user, q.tenant_id, "read");
    return c.json(await svc.get(tenantTarget(c.var.user, tenantId), id));
  });
  r.put(`${SOURCE_CREDENTIALS}/:id`, async (c) => {
    const id = parseIdParam(c);
    const q = parseAdminQuery(c, SourceCredentialTenantQuerySchema);
    const tenantId = credentialTenant(c.var.user, q.tenant_id, "read");
    const b = await parseJson(c, HubSecretRotateRequestSchema);
    return c.json(await svc.rotate(c.var.user, tenantTarget(c.var.user, tenantId), id, b));
  });
  r.delete(`${SOURCE_CREDENTIALS}/:id`, async (c) => {
    const id = parseIdParam(c);
    const q = parseAdminQuery(c, SourceCredentialDeleteQuerySchema);
    const tenantId = credentialTenant(c.var.user, q.tenant_id, "read");
    await svc.remove(c.var.user, tenantTarget(c.var.user, tenantId), id, q.version);
    return c.body(null, 204);
  });
  return r;
}
