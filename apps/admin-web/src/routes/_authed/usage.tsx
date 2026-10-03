import { createFileRoute } from "@tanstack/react-router";
import { UsagePage } from "@/features/usage/pages/UsagePage";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// `?tenant=<mã>&period=YYYY-MM` (tenant_admin: tenant bị ép tenant mình, xem use-usage-view).
export const Route = createFileRoute("/_authed/usage")({
  validateSearch: (s: Record<string, unknown>): { tenant?: string; period?: string } => ({
    tenant: str(s.tenant),
    period: str(s.period),
  }),
  component: UsagePage,
});
