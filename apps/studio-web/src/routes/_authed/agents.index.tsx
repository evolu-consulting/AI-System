// Màn Agents nạp lười (ngân sách JS ban đầu 150 KB — plan-frontend §8).
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { parseSearch } from "#/features/agents/lib/filters";

export const Route = createFileRoute("/_authed/agents/")({
  validateSearch: parseSearch,
  component: lazyRouteComponent(() => import("#/features/agents/pages/AgentsPage"), "AgentsPage"),
});
