// CR-112 · ADM-FR-80/81/82 · `/admin/app-roles*`: platform_admin (mọi tenant, `?tenant_id=`) + tenant_admin (tenant mình;
// tenant/vai khác ⇒ 404). member ⇒ 403 trước khi tra thực thể hay parse body. Prefix riêng (không dưới `/admin/tenants`, nơi
// middleware chỉ-platform của các route khác áp cho mọi đường con).
import {
  AppRoleCreateRequestSchema,
  AppRoleListQuerySchema,
  AppRoleMembersAddRequestSchema,
  AppRoleUpdateRequestSchema,
} from "@ai/contracts/app-roles";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import { addRoleMembers, removeRoleMember } from "./app-roles.members";
import { type Call, createRole, deleteRole, listRoles, updateRole } from "./app-roles.service";

const TenantIdQuery = AppRoleListQuerySchema.pick({ tenant_id: true });

export function appRolesRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin", "tenant_admin"));

  r.get("/", async (c) => c.json(await listRoles(call(c), parseQuery(c, AppRoleListQuerySchema))));
  r.post("/", async (c) => {
    const { tenant_id } = parseQuery(c, TenantIdQuery);
    const input = await parseJson(c, AppRoleCreateRequestSchema);
    return c.json(await createRole(call(c), tenant_id, input), 201);
  });
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    return c.json(await updateRole(call(c), id, await parseJson(c, AppRoleUpdateRequestSchema)));
  });
  r.delete("/:id", async (c) => {
    await deleteRole(call(c), parseIdParam(c));
    return c.body(null, 204);
  });
  r.post("/:id/members", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, AppRoleMembersAddRequestSchema);
    return c.json(await addRoleMembers(call(c), id, input));
  });
  r.delete("/:id/members/:user_id", async (c) => {
    const id = parseIdParam(c);
    await removeRoleMember(call(c), id, parseIdParam(c, "user_id"));
    return c.body(null, 204);
  });
  return r;
}
