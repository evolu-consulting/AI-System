// ADM-FR-65 · CR-056 · P-a: `/processes/$processId/runs/$runId` — trang lượt chạy của admin (PF4). Hậu tố `_` ⇒ không lồng vào editor.
import { createFileRoute } from "@tanstack/react-router";
import { ProcessRunPage } from "@/features/processes/pages/ProcessRunPage";

function Page() {
  const { processId, runId } = Route.useParams();
  return <ProcessRunPage processId={processId} runId={runId} />;
}

export const Route = createFileRoute("/_authed/processes/$processId_/runs/$runId")({
  component: Page,
});
