// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-BR-05, ADM-BR-09 · /admin/users* (spec M1 §3).
// platform_admin + tenant_admin; member → 403 trước khi tra thực thể hay parse body.
import {
  UserCreateRequestSchema,
  UserListQuerySchema,
  UserUpdateRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import {
  type Call,
  createUser,
  disableUserTotp,
  getUser,
  listUsers,
  lockUser,
  logoutAll,
  resetPassword,
  unlockUser,
  updateUser,
} from "./users.service";

const TenantIdQuery = UserListQuerySchema.pick({ tenant_id: true });

export function usersRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin", "tenant_admin"));

  r.get("/", async (c) => c.json(await listUsers(call(c), parseQuery(c, UserListQuerySchema))));
  r.post("/", async (c) => {
    const { tenant_id } = parseQuery(c, TenantIdQuery);
    const input = await parseJson(c, UserCreateRequestSchema);
    return c.json(await createUser(call(c), tenant_id, input), 201);
  });
  r.get("/:id", async (c) => c.json(await getUser(call(c), parseIdParam(c))));
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, UserUpdateRequestSchema);
    return c.json(await updateUser(call(c), id, input));
  });
  r.post("/:id/lock", async (c) => c.json(await lockUser(call(c), parseIdParam(c))));
  r.post("/:id/unlock", async (c) => c.json(await unlockUser(call(c), parseIdParam(c))));
  r.post("/:id/logout-all", async (c) => {
    await logoutAll(call(c), parseIdParam(c));
    return c.body(null, 204);
  });
  r.post("/:id/reset-password", async (c) => c.json(await resetPassword(call(c), parseIdParam(c))));
  // ADM-FR-08 · plan-cd §4.2: body rỗng (không parse); trả 200 User.
  r.post("/:id/totp/disable", async (c) => c.json(await disableUserTotp(call(c), parseIdParam(c))));
  return r;
}
