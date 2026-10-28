// CR-102a · ADM-FR-75 · /admin/external-orgs* (com-c1-ext-identity). platform_admin + tenant_admin; member → 403 trước khi
// tra thực thể hay parse body. Khoá/mở khoá/reset mật khẩu user ngoài dùng lại /admin/users/:id/*.
import {
  ExternalOrgCreateRequestSchema,
  ExternalOrgListQuerySchema,
  ExternalOrgUpdateRequestSchema,
  ExternalUserCreateRequestSchema,
  UserListQuerySchema,
  UuidSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import {
  type Call,
  createOrg,
  createOrgUser,
  deactivateOrg,
  deactivateOrgUser,
  getOrg,
  listOrgs,
  listUsersOfOrg,
  reactivateOrg,
  renameOrg,
} from "./external-orgs.service";

const TenantIdQuery = ExternalOrgListQuerySchema.pick({ tenant_id: true });
const OrgUsersQuery = UserListQuerySchema.pick({
  q: true,
  limit: true,
  offset: true,
  status: true,
});

/** `:user_id` hỏng → 404 như id lạ (không lộ cấu trúc). */
function userIdParam(c: Context<AppVars>): string {
  const r = UuidSchema.safeParse(c.req.param("user_id"));
  if (!r.success) throw appError("NOT_FOUND");
  return r.data;
}

export function externalOrgsRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin", "tenant_admin"));

  r.get("/", async (c) =>
    c.json(await listOrgs(call(c), parseQuery(c, ExternalOrgListQuerySchema))),
  );
  r.post("/", async (c) => {
    const { tenant_id } = parseQuery(c, TenantIdQuery);
    const input = await parseJson(c, ExternalOrgCreateRequestSchema);
    return c.json(await createOrg(call(c), tenant_id, input), 201);
  });
  r.get("/:id", async (c) => c.json(await getOrg(call(c), parseIdParam(c))));
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, ExternalOrgUpdateRequestSchema);
    return c.json(await renameOrg(call(c), id, input));
  });
  r.post("/:id/deactivate", async (c) => c.json(await deactivateOrg(call(c), parseIdParam(c))));
  r.post("/:id/reactivate", async (c) => c.json(await reactivateOrg(call(c), parseIdParam(c)))); // com-c2
  r.get("/:id/users", async (c) => {
    const id = parseIdParam(c);
    const q = { ...UserListQuerySchema.parse({}), ...parseQuery(c, OrgUsersQuery) };
    return c.json(await listUsersOfOrg(call(c), id, q));
  });
  r.post("/:id/users", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, ExternalUserCreateRequestSchema);
    return c.json(await createOrgUser(call(c), id, input), 201);
  });
  r.post("/:id/users/:user_id/deactivate", async (c) => {
    const id = parseIdParam(c);
    return c.json(await deactivateOrgUser(call(c), id, userIdParam(c)));
  });
  return r;
}
