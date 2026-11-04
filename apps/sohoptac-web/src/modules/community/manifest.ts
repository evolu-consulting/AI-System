// CR-118 · COM-FR-31 (MODIFIED) · manifest module Community — dữ liệu route + nhà máy cây route tương thích TanStack Router.
// Shell chỉ đọc file này (luật web-shell-manifest-only). KHÔNG khởi tạo router ở đây: host truyền `createRoute` + route cha
// (`createRoute` của @tanstack/react-router, `lazyRouteComponent` làm `lazy`). Trang tải lười ⇒ module tắt không có chunk.
import type { ComponentType } from "react";
import { type CommunityHostConfig, setCommunityHost } from "./application/host";
import { COMMUNITY_BASE } from "./domain/base";

export type CommunityRouteId = "feed" | "profile" | "profileOrg" | "profileSection";
export type PageLoader = () => Promise<{ default: ComponentType }>;
export type CommunityRouteDef = { id: CommunityRouteId; path: string };
export type { LowRouter } from "./application/router-port";
export type { CommunityHostConfig };

/** Khoá gói quyền (FeatureGate) của module. */
export const COMMUNITY_PACK = "community";

/** Route con tương đối dưới `/community` (khung); `?settings=1` mở hộp thoại Cài đặt, không phải route. Giữ gọn: nằm trong bundle đầu. */
const CHILD_PATHS = ["/", "/profile", "/profile/$orgId", "/profile/$orgId/$section"] as const;

/** Route của module (đường dẫn tuyệt đối từ gốc router). */
export const communityRoutes: readonly CommunityRouteDef[] = CHILD_PATHS.map((p, i) => ({
  id: (["feed", "profile", "profileOrg", "profileSection"] as const)[i] as CommunityRouteId,
  path: p === "/" ? COMMUNITY_BASE : COMMUNITY_BASE + p,
}));

/** Shell gọi một lần (router, đăng xuất, điều hướng sang Sổ Hợp Tác) trước khi route Community được dựng. */
export const configureCommunityHost = (h: CommunityHostConfig): void => setCommunityHost(h);

/** Trang của module: một chunk (Shell Bảng tin/Hồ sơ chọn theo route). Gói dịch + API nạp trong `ui/entry` (Suspense của shell chờ). */
export const loadCommunityPage: PageLoader = () =>
  import(/* webpackChunkName: "cm" */ "./ui/entry");

export type RouteHost<Parent, Route, Component> = {
  parent: Parent;
  createRoute: (o: {
    getParentRoute: () => Parent | Route;
    path: string;
    component?: Component;
  }) => Route;
  /** Gắn route con vào route cha (TanStack: `route.addChildren`). */
  addChildren: (parent: Route, children: Route[]) => Route;
  /** Bọc bộ tải thành component tải lười (TanStack: `lazyRouteComponent`). */
  lazy: (load: PageLoader) => Component;
};

/**
 * Cây route Community cho router của host: MỘT route khung `/community` (component lười, giữ trạng thái khi đổi Bảng tin ↔ Hồ sơ)
 * + route con theo `communityRoutes`. Trả route khung đã gắn con; host gắn vào cây của mình.
 */
export function createCommunityRoutes<Parent, Route, Component>(
  host: RouteHost<Parent, Route, Component>,
): Route {
  const layout = host.createRoute({
    getParentRoute: () => host.parent,
    path: COMMUNITY_BASE,
    component: host.lazy(loadCommunityPage),
  });
  const kids = CHILD_PATHS.map((path) => host.createRoute({ getParentRoute: () => layout, path }));
  return host.addChildren(layout, kids);
}

export const communityManifest = {
  key: COMMUNITY_PACK,
  base: COMMUNITY_BASE,
  home: COMMUNITY_BASE,
  requires: { pack: COMMUNITY_PACK, action: "read" as const },
  routes: communityRoutes,
} as const;
