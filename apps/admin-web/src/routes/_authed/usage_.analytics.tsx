import { createFileRoute } from "@tanstack/react-router";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import type { AnalyticsSearch } from "@/features/usage-analytics/hooks/use-analytics-view";
import { UsageAnalyticsPage } from "@/features/usage-analytics/pages/UsageAnalyticsPage";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// ADM-FR-42 · `/usage/analytics?tenant=<mã>&preset=30d|from=&to=&grain=&app=&agent=&model=&user=&outcome=`
// (tenant_admin: tenant bị ép tenant mình — server cũng ép).
// 2026-10-21: phân tích chi tiết chỉ platform_admin (tenant_admin → ForbiddenState; API 403).
const Page = () => (
  <PlatformOnly>
    <UsageAnalyticsPage />
  </PlatformOnly>
);
export const Route = createFileRoute("/_authed/usage_/analytics")({
  validateSearch: (s: Record<string, unknown>): AnalyticsSearch => ({
    tenant: str(s.tenant),
    preset: str(s.preset),
    from: str(s.from),
    to: str(s.to),
    grain: str(s.grain),
    app: str(s.app),
    agent: str(s.agent),
    model: str(s.model),
    user: str(s.user),
    outcome: str(s.outcome),
  }),
  component: Page,
});
