// HUB-FR-131 · màn Cài đặt (KnowledgeHub) nạp lười.
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings")({
  component: lazyRouteComponent(
    () => import("#/features/settings/knowledgehub/pages/KnowledgeHubSettingsPage"),
    "KnowledgeHubSettingsPage",
  ),
});
