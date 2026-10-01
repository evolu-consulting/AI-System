import { createFileRoute } from "@tanstack/react-router";
import { AuthedLayout } from "@/features/shell/components/AuthedLayout";
import { requireSession } from "@/features/shell/lib/guard";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ location }) => requireSession(location),
  component: AuthedLayout,
});
