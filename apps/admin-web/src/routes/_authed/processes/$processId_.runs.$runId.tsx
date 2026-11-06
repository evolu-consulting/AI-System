// ADM-FR-65 · CR-056 · P-a: `/processes/$processId/runs/$runId` — trang lượt chạy của admin (PF4). Hậu tố `_` ⇒ không lồng vào editor.
// `?company=<id>` (CR-121 f3): platform mở từ Công ty › Quy trình của công ty đó (tenant_admin không cần — Hub suy từ phiên).
import { createFileRoute } from "@tanstack/react-router";
import { ProcessRunPage } from "@/features/processes/pages/ProcessRunPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Page() {
  const { processId, runId } = Route.useParams();
  const { company } = Route.useSearch();
  return <ProcessRunPage processId={processId} runId={runId} {...(company ? { company } : {})} />;
}

export const Route = createFileRoute("/_authed/processes/$processId_/runs/$runId")({
  validateSearch: (s: Record<string, unknown>): { company?: string } =>
    typeof s.company === "string" && UUID.test(s.company) ? { company: s.company } : {},
  component: Page,
});
