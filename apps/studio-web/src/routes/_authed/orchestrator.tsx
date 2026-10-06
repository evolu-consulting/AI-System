// Màn Orchestrator nạp lười (ngân sách JS ban đầu — plan-frontend §8). `?tenant=<tenant_id>|new` mở Sheet bản tenant.
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/orchestrator")({
  validateSearch: (raw: Record<string, unknown>): { tenant?: string } => ({
    tenant: typeof raw.tenant === "string" && raw.tenant !== "" ? raw.tenant : undefined,
  }),
  component: lazyRouteComponent(
    () => import("#/features/orchestrator/pages/OrchestratorPage"),
    "OrchestratorPage",
  ),
});
