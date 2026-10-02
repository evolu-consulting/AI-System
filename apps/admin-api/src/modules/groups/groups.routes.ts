// ADM-FR-62, ADM-FR-55, ADM-BR-05, ADM-BR-09 · /admin/groups* (spec M3 §3). platform_admin + tenant_admin; member → 403
// trước khi tra thực thể hay parse body.
import {
  GroupCreateRequestSchema,
  GroupListQuerySchema,
  GroupMemberListQuerySchema,
  GroupMembersAddRequestSchema,
  GroupUpdateRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import { addMembers, listMembers, removeMember } from "./groups.members";
import {
  type Call,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  updateGroup,
} from "./groups.service";

const TenantIdQuery = GroupListQuerySchema.pick({ tenant_id: true });

export function groupsRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin", "tenant_admin"));

  r.get("/", async (c) => c.json(await listGroups(call(c), parseQuery(c, GroupListQuerySchema))));
  r.post("/", async (c) => {
    const { tenant_id } = parseQuery(c, TenantIdQuery);
    const input = await parseJson(c, GroupCreateRequestSchema);
    return c.json(await createGroup(call(c), tenant_id, input), 201);
  });
  r.get("/:id", async (c) => c.json(await getGroup(call(c), parseIdParam(c))));
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    return c.json(await updateGroup(call(c), id, await parseJson(c, GroupUpdateRequestSchema)));
  });
  r.delete("/:id", async (c) => {
    await deleteGroup(call(c), parseIdParam(c));
    return c.body(null, 204);
  });
  r.get("/:id/members", async (c) => {
    const id = parseIdParam(c);
    return c.json(await listMembers(call(c), id, parseQuery(c, GroupMemberListQuerySchema)));
  });
  r.post("/:id/members", async (c) => {
    const id = parseIdParam(c);
    return c.json(await addMembers(call(c), id, await parseJson(c, GroupMembersAddRequestSchema)));
  });
  r.delete("/:id/members/:user_id", async (c) => {
    const id = parseIdParam(c);
    await removeMember(call(c), id, parseIdParam(c, "user_id"));
    return c.body(null, 204);
  });
  return r;
}
