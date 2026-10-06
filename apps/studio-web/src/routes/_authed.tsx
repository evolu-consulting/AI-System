// Layout có khung. F2 thêm guard (phiên + `me`) ở `beforeLoad` của route này.
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "#/features/shell/components/AppShell";

export const Route = createFileRoute("/_authed")({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
