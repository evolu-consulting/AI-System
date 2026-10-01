import { createFileRoute } from "@tanstack/react-router";
import { FeatureEditorPage, type FeatureTab } from "@/features/features/pages/FeatureEditorPage";

export type FeatureEditorSearch = { tab?: FeatureTab };

export const parseFeatureTab = (v: unknown): FeatureTab | undefined =>
  (["info", "commands", "tenants"] as const).find((t) => t === v);

function Page() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <FeatureEditorPage
      tab={tab ?? "info"}
      onTab={(t) => void navigate({ search: { tab: t }, replace: true })}
    />
  );
}

export const Route = createFileRoute("/_authed/features/new")({
  validateSearch: (s: Record<string, unknown>): FeatureEditorSearch => ({
    tab: parseFeatureTab(s.tab),
  }),
  component: Page,
});
