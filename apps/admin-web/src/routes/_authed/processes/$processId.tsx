// ADM-FR-66 · CR-056 · P-a: `/processes/$processId` — editor / xem quy trình (PF4).
import { createFileRoute } from "@tanstack/react-router";
import { ProcessEditorPage } from "@/features/processes/pages/ProcessEditorPage";

function Page() {
  const { processId } = Route.useParams();
  return <ProcessEditorPage processId={processId} />;
}

export const Route = createFileRoute("/_authed/processes/$processId")({ component: Page });
