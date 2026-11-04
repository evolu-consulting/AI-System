// C1 FE · route gốc: Outlet + Toaster dùng chung (toast "Phiên đã hết hạn"…); đường lạ → `/c/new` (plan-frontend §2).
// CR-118 bundle: Toaster (sonner) tải lười — không nằm trong JS ban đầu.
import { createRootRoute, Navigate, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const Toaster = lazy(() => import("~/components/ui/sonner").then((m) => ({ default: m.Toaster })));

function Root() {
  return (
    <>
      <Outlet />
      <Suspense fallback={null}>
        <Toaster position="bottom-right" />
      </Suspense>
    </>
  );
}

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: () => <Navigate to="/c/new" replace />,
});
