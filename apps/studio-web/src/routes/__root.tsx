import { createRootRoute, lazyRouteComponent, Outlet } from "@tanstack/react-router";
import { Toaster } from "#/components/ui/sonner";
import { SessionWatcher } from "#/features/shell/components/SessionWatcher";

// Toaster ở gốc: toast `session.expired` hiện cả trên trang đăng nhập.
export const Route = createRootRoute({
  component: () => (
    <>
      <SessionWatcher />
      <Outlet />
      <Toaster position="bottom-right" />
    </>
  ),
  // Trang 404 kéo cả khung nên nạp lười để không vào JS ban đầu (ngân sách 150 KB).
  notFoundComponent: lazyRouteComponent(
    () => import("#/features/shell/pages/NotFoundPage"),
    "NotFoundPage",
  ),
});
