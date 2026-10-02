import { createFileRoute } from "@tanstack/react-router";
import { GroupCreatePage } from "@/features/groups/pages/GroupCreatePage";

export type GroupNewSearch = { tenant?: string };

export const Route = createFileRoute("/_authed/groups/new")({
  validateSearch: (s: Record<string, unknown>): GroupNewSearch => ({
    tenant: typeof s.tenant === "string" && s.tenant !== "" ? s.tenant : undefined,
  }),
  component: GroupCreatePage,
});
