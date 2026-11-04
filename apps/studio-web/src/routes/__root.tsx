import { createRootRoute, lazyRouteComponent, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { SessionWatcher } from "#/features/shell/components/SessionWatcher";

// CR-118 bundle: Toaster (sonner) tải lười — không nằm trong JS ban đầu.
const Toaster = lazy(() => import("#/components/ui/sonner").then((m) => ({ default: m.Toaster })));

// Toaster ở gốc: toast `session.expired` hiện cả trên trang đăng nhập.
export const Route = createRootRoute({
  component: () => (
    <>
      <SessionWatcher />
      <Outlet />
      <Suspense fallback={null}>
        <Toaster position="top-center" />
      </Suspense>
    </>
  ),
  // Trang 404 kéo cả khung nên nạp lười để không vào JS ban đầu (ngân sách 150 KB).
  notFoundComponent: lazyRouteComponent(
    () => import("#/features/shell/pages/NotFoundPage"),
    "NotFoundPage",
  ),
});
