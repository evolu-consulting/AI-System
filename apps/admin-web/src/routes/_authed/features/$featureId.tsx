import { createFileRoute } from "@tanstack/react-router";
import { FeatureEditorPage } from "@/features/features/pages/FeatureEditorPage";
import { type FeatureEditorSearch, parseFeatureTab } from "./new";

function Page() {
  const { featureId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <FeatureEditorPage
      featureId={featureId}
      tab={tab ?? "info"}
      onTab={(t) => void navigate({ search: { tab: t }, replace: true })}
    />
  );
}

export const Route = createFileRoute("/_authed/features/$featureId")({
  validateSearch: (s: Record<string, unknown>): FeatureEditorSearch => ({
    tab: parseFeatureTab(s.tab),
  }),
  component: Page,
});
