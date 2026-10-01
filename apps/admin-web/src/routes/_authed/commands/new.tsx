import { createFileRoute } from "@tanstack/react-router";
import { CommandEditorPage } from "@/features/commands/pages/CommandEditorPage";

export type CommandNewSearch = { from?: string; workflow?: string; tab?: "config" | "access" };

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function Page() {
  const { from, workflow } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CommandEditorPage
      from={from}
      workflow={workflow}
      tab="config"
      onTab={(tab) => void navigate({ search: (prev) => ({ ...prev, tab }), replace: true })}
    />
  );
}

// `?from=<id>` nhân bản, `?workflow=<id>` chọn sẵn workflow (từ Workflows → "Tạo command").
export const Route = createFileRoute("/_authed/commands/new")({
  validateSearch: (s: Record<string, unknown>): CommandNewSearch => ({
    from: str(s.from),
    workflow: str(s.workflow),
    tab: s.tab === "config" || s.tab === "access" ? s.tab : undefined,
  }),
  component: Page,
});
