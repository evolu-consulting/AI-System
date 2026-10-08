import { createFileRoute } from "@tanstack/react-router";
import { AgentsPage } from "@/features/agents/pages/AgentsPage";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

// CR-054 · `?tenant=<mã>` (chỉ platform_admin; tenant_admin luôn xem tenant mình).
export const Route = createFileRoute("/_authed/agents")({
  validateSearch: (s: Record<string, unknown>): { tenant?: string } => ({ tenant: str(s.tenant) }),
  component: AgentsPage,
});
