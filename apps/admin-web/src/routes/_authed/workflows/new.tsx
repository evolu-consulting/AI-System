import { createFileRoute } from "@tanstack/react-router";
import { type EditorTab, WorkflowEditorPage } from "@/features/workflows/pages/WorkflowEditorPage";

export type WorkflowEditorSearch = { tab?: EditorTab };

export const parseEditorTab = (v: unknown): EditorTab | undefined =>
  (["info", "input", "preview", "usage"] as const).find((t) => t === v);

function Page() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WorkflowEditorPage
      tab={tab ?? "info"}
      onTab={(t) => void navigate({ search: { tab: t }, replace: true })}
    />
  );
}

export const Route = createFileRoute("/_authed/workflows/new")({
  validateSearch: (s: Record<string, unknown>): WorkflowEditorSearch => ({
    tab: parseEditorTab(s.tab),
  }),
  component: Page,
});
