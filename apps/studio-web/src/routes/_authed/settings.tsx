// HUB-FR-131 · màn Cài đặt (KnowledgeHub) nạp lười.
import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { frozenModulesOn } from "#/lib/frozen";

export const Route = createFileRoute("/_authed/settings")({
  // F1 (CR-095): KnowledgeHub cũ đóng băng — cờ off ⇒ về trang chủ.
  beforeLoad: () => {
    if (!frozenModulesOn) throw redirect({ to: "/" });
  },
  component: lazyRouteComponent(
    () => import("#/features/settings/knowledgehub/pages/KnowledgeHubSettingsPage"),
    "KnowledgeHubSettingsPage",
  ),
});
