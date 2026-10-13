// HUB-FR-78 · màn Quyền agent nạp lười (plan-frontend H4b2 D2): ma trận agent × tenant.
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/access")({
  component: lazyRouteComponent(() => import("#/features/access/pages/AccessPage"), "AccessPage"),
});
