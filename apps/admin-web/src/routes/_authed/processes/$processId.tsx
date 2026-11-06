// ADM-FR-66 · CR-056 · P-a: `/processes/$processId` — editor / xem quy trình (PF4). `?company=<id>` (CR-121 c17): mở từ Công ty › Quy trình.
import { createFileRoute } from "@tanstack/react-router";
import { ProcessEditorPage } from "@/features/processes/pages/ProcessEditorPage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Page() {
  const { processId } = Route.useParams();
  const { company } = Route.useSearch();
  return <ProcessEditorPage processId={processId} {...(company ? { company } : {})} />;
}

export const Route = createFileRoute("/_authed/processes/$processId")({
  validateSearch: (s: Record<string, unknown>): { company?: string } =>
    typeof s.company === "string" && UUID.test(s.company) ? { company: s.company } : {},
  component: Page,
});
