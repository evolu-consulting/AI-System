// ADM-FR-73 · AC-A15 · TT-R03 (plan-contract §6) · /admin/tenants/:id/workflow-tools*. Chỉ platform_admin.
import { TenantWorkflowToolPutSchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import {
  type AppVars,
  type AuthDeps,
  requireAuth,
  requireRole,
} from "../../../lib/auth-middleware";
import { appError } from "../../../lib/errors";
import { parseIdParam, parseJson } from "../../../lib/http";
import { listTools, ToolNotFoundError, type ToolsTx, toggleTool } from "../application";
import { toTenantWorkflowTool } from "./workflow-tools.mapper";

/** Dựng `ToolsTx` cho một request (scope + actor của request) — mount nối `withScope`/`configWrite`. */
export type ToolsTxOf = (c: Context<AppVars>) => ToolsTx;

async function mapErr<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ToolNotFoundError) throw appError("NOT_FOUND");
    throw e;
  }
}

export function workflowToolsRoutes(d: AuthDeps, txOf: ToolsTxOf): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("/:id/workflow-tools", requireAuth(d), requireRole("platform_admin"));
  r.use("/:id/workflow-tools/*", requireAuth(d), requireRole("platform_admin"));
  const key = (c: Context<AppVars>) => ({
    tenantId: parseIdParam(c),
    workflowId: parseIdParam(c, "workflow_id"),
  });
  const toggle = async (c: Context<AppVars>, want: "on" | "off") => {
    const k = key(c);
    const v = await mapErr(toggleTool(txOf(c), k, c.get("actor").userId, want));
    return c.json(toTenantWorkflowTool(v));
  };

  r.get("/:id/workflow-tools", async (c) => {
    const items = await mapErr(listTools(txOf(c), parseIdParam(c)));
    return c.json({ items: items.map(toTenantWorkflowTool) });
  });
  r.put("/:id/workflow-tools/:workflow_id", async (c) => {
    await parseJson(c, TenantWorkflowToolPutSchema);
    return toggle(c, "on");
  });
  r.delete("/:id/workflow-tools/:workflow_id", (c) => toggle(c, "off"));
  return r;
}
