// C1 FE · route gốc: Outlet + Toaster dùng chung (toast "Phiên đã hết hạn"…); đường lạ → `/c/new` (plan-frontend §2).
import { createRootRoute, Navigate, Outlet } from "@tanstack/react-router";
import { Toaster } from "~/components/ui/sonner";

function Root() {
  return (
    <>
      <Outlet />
      <Toaster position="bottom-right" />
    </>
  );
}

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: () => <Navigate to="/c/new" replace />,
});
