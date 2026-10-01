import { createFileRoute } from "@tanstack/react-router";
import { CommandEditorPage } from "@/features/commands/pages/CommandEditorPage";

function Page() {
  const { commandId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CommandEditorPage
      commandId={commandId}
      tab={tab ?? "config"}
      onTab={(t) => void navigate({ search: { tab: t }, replace: true })}
    />
  );
}

export const Route = createFileRoute("/_authed/commands/$commandId")({
  validateSearch: (s: Record<string, unknown>): { tab?: "config" | "access" } => ({
    tab: s.tab === "config" || s.tab === "access" ? s.tab : undefined,
  }),
  component: Page,
});
