// ADM-FR-10, ADM-FR-11, ADM-FR-13, ADM-FR-14, ADM-FR-15 · /admin/workflows* (spec M2 §3). Chỉ platform_admin.
// Không có route grant/quyền (BR-13), "Kiểm tra kết nối" hay "Lấy schema từ Dify" (A8).
import {
  WorkflowCreateRequestSchema,
  WorkflowListQuerySchema,
  WorkflowUpdateRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseQuery } from "../../lib/http";
import {
  type Call,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowUsages,
  listWorkflows,
  updateWorkflow,
  type WorkflowsCtx,
} from "./workflows.service";

export function workflowsRoutes(d: AuthDeps & WorkflowsCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin"));

  r.get("/", async (c) =>
    c.json(await listWorkflows(call(c), parseQuery(c, WorkflowListQuerySchema))),
  );
  r.post("/", async (c) => {
    const input = await parseJson(c, WorkflowCreateRequestSchema);
    return c.json(await createWorkflow(call(c), input), 201);
  });
  r.get("/:id", async (c) => c.json(await getWorkflow(call(c), parseIdParam(c))));
  r.get("/:id/usages", async (c) => c.json(await getWorkflowUsages(call(c), parseIdParam(c))));
  r.patch("/:id", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, WorkflowUpdateRequestSchema);
    return c.json(await updateWorkflow(call(c), id, input));
  });
  r.delete("/:id", async (c) => {
    await deleteWorkflow(call(c), parseIdParam(c));
    return c.body(null, 204);
  });
  return r;
}
