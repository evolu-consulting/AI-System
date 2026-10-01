import { createFileRoute } from "@tanstack/react-router";
import { WorkflowEditorPage } from "@/features/workflows/pages/WorkflowEditorPage";
import { parseEditorTab, type WorkflowEditorSearch } from "./new";

function Page() {
  const { workflowId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WorkflowEditorPage
      workflowId={workflowId}
      tab={tab ?? "info"}
      onTab={(t) => void navigate({ search: { tab: t }, replace: true })}
    />
  );
}

export const Route = createFileRoute("/_authed/workflows/$workflowId")({
  validateSearch: (s: Record<string, unknown>): WorkflowEditorSearch => ({
    tab: parseEditorTab(s.tab),
  }),
  component: Page,
});
