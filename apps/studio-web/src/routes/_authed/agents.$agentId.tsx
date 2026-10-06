// Editor sửa agent (key/runtime bất biến — QB5). Nạp lười như màn Agents.
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

const Page = lazyRouteComponent(
  () => import("#/features/agents/pages/AgentEditorPage"),
  "AgentEditorPage",
);

export const Route = createFileRoute("/_authed/agents/$agentId")({
  component: function EditAgentRoute() {
    const { agentId } = Route.useParams();
    return <Page key={agentId} agentId={agentId} />;
  },
});
