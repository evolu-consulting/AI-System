// ADM-FR-42 · usage-analytics · `GET /admin/usage/analytics`, `/admin/usage/records`, `/admin/usage/records.csv`,
// `/admin/usage/runs/:id` (mount ở `/admin`, guard theo route như `usage.routes`): chỉ platform_admin; tenant_admin/member 403.
import { UsageAnalyticsQuerySchema, UsageRecordsQuerySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseQuery } from "../../lib/http";
import { type AnalyticsCall, type AnalyticsCtx, getAnalytics } from "./analytics.service";
import { getRecords, getRecordsCsv, getRun } from "./records.service";

export function usageAnalyticsRoutes(d: AuthDeps & AnalyticsCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): AnalyticsCall => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  // 2026-10-21: phân tích chi tiết (model/agent/bản ghi thô/CSV/run) chỉ platform_admin; tenant_admin → 403.
  const guard = [requireAuth(d), requireRole("platform_admin")] as const;

  r.get("/usage/analytics", ...guard, async (c) =>
    c.json(await getAnalytics(call(c), parseQuery(c, UsageAnalyticsQuerySchema))),
  );
  r.get("/usage/records", ...guard, async (c) =>
    c.json(await getRecords(call(c), parseQuery(c, UsageRecordsQuerySchema))),
  );
  r.get("/usage/records.csv", ...guard, async (c) => {
    const out = await getRecordsCsv(call(c), parseQuery(c, UsageRecordsQuerySchema));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${out.filename}"`);
    return c.body(out.body);
  });
  r.get("/usage/runs/:id", ...guard, async (c) => c.json(await getRun(call(c), parseIdParam(c))));
  return r;
}
