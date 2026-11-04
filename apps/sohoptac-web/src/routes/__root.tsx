// PK-FR-10 · TF1 · route gốc: Outlet + Toaster dùng chung; đường lạ → `/contracts` (plan-frontend §1).
import { createRootRoute, Navigate, Outlet } from "@tanstack/react-router";
import { DialogHost } from "~/components/shared/dialog-host";
import { Toaster } from "~/components/ui/sonner";

function Root() {
  return (
    <>
      <Outlet />
      <DialogHost />
      <Toaster position="bottom-right" />
    </>
  );
}

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: () => <Navigate to="/contracts" replace />,
});
