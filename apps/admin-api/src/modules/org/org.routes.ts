// M1D-FR-02 · M1D-FR-03 · `/admin/org*`: cơ cấu tổ chức (quản lý + phòng ban + sửa cơ cấu CR-189). platform_admin + tenant_admin; member → 403
// trước khi tra thực thể hay parse body (như `/admin/groups`).
import {
  DepartmentSetRequestSchema,
  DeptCreateRequestSchema,
  DeptMembersAddRequestSchema,
  DeptRenameRequestSchema,
  JobTitleSetRequestSchema,
  ManagerSetRequestSchema,
  OrgMembersQuerySchema,
  OrgQuerySchema,
} from "@ai/contracts/org";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import {
  getOrg,
  listOrgMembers,
  type OrgCall,
  setDepartment,
  setJobTitle,
  setManager,
} from "./org.service";
import { addDeptMembers, removeDeptMember } from "./org-dept.members";
import { createDept, deleteDept, renameDept } from "./org-dept.service";

export function orgRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): OrgCall => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  const tenant = (c: Context<AppVars>) => parseQuery(c, OrgQuerySchema).tenant_id;
  r.use("*", requireAuth(d), requireRole("platform_admin", "tenant_admin"));

  r.get("/", async (c) => c.json(await getOrg(call(c), tenant(c))));
  r.get("/members", async (c) => {
    const q = parseQuery(c, OrgMembersQuerySchema);
    return c.json(await listOrgMembers(call(c), q));
  });
  r.put("/managers/:id", async (c) => {
    const id = parseIdParam(c);
    const body = await parseJson(c, ManagerSetRequestSchema);
    return c.json(await setManager(call(c), tenant(c), id, body));
  });
  r.put("/members/:id/title", async (c) => {
    const id = parseIdParam(c);
    const body = await parseJson(c, JobTitleSetRequestSchema);
    return c.json(await setJobTitle(call(c), tenant(c), id, body));
  });
  r.put("/departments/:id", async (c) => {
    const id = parseIdParam(c);
    const body = await parseJson(c, DepartmentSetRequestSchema);
    return c.json(await setDepartment(call(c), tenant(c), id, body));
  });
  // CR-189 · BR-189-6: sửa cơ cấu trên sơ đồ.
  r.post("/departments", async (c) => {
    const body = await parseJson(c, DeptCreateRequestSchema);
    return c.json(await createDept(call(c), tenant(c), body), 201);
  });
  r.put("/departments/:id/name", async (c) => {
    const id = parseIdParam(c);
    const body = await parseJson(c, DeptRenameRequestSchema);
    return c.json(await renameDept(call(c), tenant(c), id, body));
  });
  r.post("/departments/:id/members", async (c) => {
    const id = parseIdParam(c);
    const body = await parseJson(c, DeptMembersAddRequestSchema);
    return c.json(await addDeptMembers(call(c), tenant(c), id, body));
  });
  r.delete("/departments/:id/members/:userId", async (c) => {
    const id = parseIdParam(c);
    return c.json(await removeDeptMember(call(c), tenant(c), id, parseIdParam(c, "userId")));
  });
  r.delete("/departments/:id", async (c) => {
    await deleteDept(call(c), tenant(c), parseIdParam(c));
    return c.body(null, 204);
  });
  return r;
}
