// ADM-FR-41 · M4-R06 · `GET /admin/quota-banner` (plan-contract §2.1): tính trực tiếp từ `evaluateQuota` (không đọc
// `quota_alerts`). platform_admin → `{banner:null}`; tenant_admin → quota có pct cao nhất của tenant mình (scope RLS +
// lọc `tenant_id`); member → 403. tenant_admin còn kích evaluator nền (chặn lặp 60 s/tenant).
import type { QuotaBannerResponse } from "@ai/contracts";
import { withScope } from "@ai/db";
import { Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { type EvaluatorCtx, evaluateThrottled } from "./quotas.evaluator";
import * as repo from "./quotas.repo";
import { bannerFor, evaluateQuota, monthRange } from "./quotas.rules";

export async function tenantBanner(
  ctx: EvaluatorCtx,
  tenantId: string,
): Promise<QuotaBannerResponse> {
  const range = monthRange(ctx.now());
  return withScope(
    ctx.db,
    { kind: "tenant", tenantId },
    async (tx) => {
      const rows = await repo.listQuotas(tx, tenantId);
      if (rows.length === 0) return { banner: null };
      const usage = await repo.monthUsage(tx, tenantId, range);
      const evals = evaluateQuota({
        quotas: rows.map((r) => ({
          featureId: r.feature_id,
          maxRuns: r.max_runs,
          maxTokens: r.max_tokens,
          maxUsd: r.max_usd,
        })),
        ...usage,
      });
      const b = bannerFor("tenant_admin", evals);
      if (!b) return { banner: null };
      const key = rows.find((r) => r.feature_id === b.featureId)?.feature_key ?? null;
      return { banner: { level: b.level, pct: b.pct, feature_key: key } };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export function quotaBannerRoutes(d: AuthDeps & EvaluatorCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.get("/", requireAuth(d), requireRole("platform_admin", "tenant_admin"), async (c) => {
    const a = c.get("actor");
    if (a.role !== "tenant_admin" || !a.tenantId) return c.json({ banner: null });
    const out = await tenantBanner(d, a.tenantId);
    evaluateThrottled(d, a.tenantId);
    return c.json(out);
  });
  return r;
}
