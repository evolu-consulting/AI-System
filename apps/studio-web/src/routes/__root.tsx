import { createRootRoute, lazyRouteComponent, Outlet } from "@tanstack/react-router";

// Trang 404 kéo cả khung nên nạp lười để không vào JS ban đầu (ngân sách 150 KB).
export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: lazyRouteComponent(
    () => import("#/features/shell/pages/NotFoundPage"),
    "NotFoundPage",
  ),
});
