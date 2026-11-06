// ADM-FR-73 · AC-A15 · TT-R03 (plan-contract §6) · /admin/tenants/:id/workflow-tools*. Chỉ platform_admin.
import { TenantWorkflowToolPutSchema } from "@ai/contracts/workflow-tools";
import { type Context, Hono } from "hono";
import {
  type AppVars,
  type AuthDeps,
  requireAuth,
  requireRole,
} from "../../../lib/auth-middleware";
import { appError } from "../../../lib/errors";
import { parseIdParam, parseJson } from "../../../lib/http";
import {
  listCompanies,
  listTools,
  listUsage,
  ToolNotFoundError,
  type ToolsTx,
  toggleTool,
} from "../application";
import { toAiToolUsage, toTenantWorkflowTool, toWorkflowCompany } from "./workflow-tools.mapper";

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

/**
 * CR-121 R6 · c16 · `/admin/workflow-tools*` — "Dùng bởi" và "Công ty dùng" của trang Công cụ AI. Chỉ platform_admin
 * (vai khác 403 ở middleware, trước khi đọc DB; tenant_admin không thấy tên công ty khác).
 */
export function aiToolsRoutes(d: AuthDeps, txOf: ToolsTxOf): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d), requireRole("platform_admin"));
  r.get("/usage", async (c) => {
    const items = await listUsage(txOf(c));
    return c.json({ items: items.map(toAiToolUsage) });
  });
  r.get("/:workflow_id/companies", async (c) => {
    const items = await mapErr(listCompanies(txOf(c), parseIdParam(c, "workflow_id")));
    return c.json({ items: items.map(toWorkflowCompany) });
  });
  return r;
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
