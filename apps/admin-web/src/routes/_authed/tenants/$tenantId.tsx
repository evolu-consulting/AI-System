import { createFileRoute } from "@tanstack/react-router";
import { TenantDetailPage, type TenantTab } from "@/features/tenants/pages/TenantDetailPage";

const TABS = ["info", "features", "agents", "quota", "users"] as const;

export const Route = createFileRoute("/_authed/tenants/$tenantId")({
  validateSearch: (s: Record<string, unknown>): { tab?: TenantTab } => ({
    tab: TABS.find((t) => t === s.tab),
  }),
  component: TenantDetailPage,
});
