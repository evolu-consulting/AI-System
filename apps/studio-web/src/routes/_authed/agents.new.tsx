// Editor tạo / nhân bản agent (`?from=<id>`, R12). Nạp lười như màn Agents.
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

const Page = lazyRouteComponent(
  () => import("#/features/agents/pages/AgentEditorPage"),
  "AgentEditorPage",
);

export const Route = createFileRoute("/_authed/agents/new")({
  validateSearch: (s: Record<string, unknown>): { from?: string } =>
    typeof s.from === "string" && s.from !== "" ? { from: s.from } : {},
  component: function NewAgentRoute() {
    const { from } = Route.useSearch();
    return <Page key={from ?? ""} from={from} />;
  },
});
