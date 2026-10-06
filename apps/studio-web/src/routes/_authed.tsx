// Layout có khung + guard phiên/`me` (H4a-R01, R02, R14 · plan-frontend D5, D6).
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "#/features/shell/components/AppShell";
import { ShellError, ShellSkeleton } from "#/features/shell/components/ShellStates";
import { requireStudio } from "#/features/shell/lib/guard";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ location }) => requireStudio(location),
  pendingComponent: ShellSkeleton,
  errorComponent: ShellError,
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
