// CR-118 · COM-FR-31 (MODIFIED) · manifest module Community — dữ liệu route + nhà máy cây route tương thích TanStack Router.
// Shell chỉ đọc file này (luật web-shell-manifest-only). KHÔNG khởi tạo router ở đây: host truyền `createRoute` + route cha
// (`createRoute` của @tanstack/react-router, `lazyRouteComponent` làm `lazy`). Trang tải lười ⇒ module tắt không có chunk.
import type { ComponentType } from "react";
import { COMMUNITY_BASE } from "./domain/route";

export type CommunityRouteId = "feed" | "profile" | "profileOrg" | "profileSection";
export type PageLoader = () => Promise<{ default: ComponentType }>;
export type CommunityRouteDef = { id: CommunityRouteId; path: string };

/** Khoá gói quyền (FeatureGate) của module. */
export const COMMUNITY_PACK = "community";

/** Route của module (đường dẫn tuyệt đối từ gốc router). `?settings=1` mở hộp thoại Cài đặt, không phải route. */
export const communityRoutes: readonly CommunityRouteDef[] = [
  { id: "feed", path: COMMUNITY_BASE },
  { id: "profile", path: `${COMMUNITY_BASE}/profile` },
  { id: "profileOrg", path: `${COMMUNITY_BASE}/profile/$orgId` },
  { id: "profileSection", path: `${COMMUNITY_BASE}/profile/$orgId/$section` },
];

/** Trang của module: một chunk (Shell Bảng tin/Hồ sơ chọn theo route). */
export const loadCommunityPage: PageLoader = () => import("./ui/entry");

/** `?settings=1` ⇒ hộp thoại Cài đặt; giá trị khác bị bỏ. */
export const validateCommunitySearch = (s: Record<string, unknown>): { settings?: "1" } =>
  s.settings === "1" || s.settings === 1 ? { settings: "1" } : {};

export type RouteHost<Parent, Route, Component> = {
  parent: Parent;
  createRoute: (o: {
    getParentRoute: () => Parent;
    path: string;
    component: Component;
    validateSearch: typeof validateCommunitySearch;
  }) => Route;
  /** Bọc bộ tải thành component tải lười (TanStack: `lazyRouteComponent`). */
  lazy: (load: PageLoader) => Component;
};

/** Tạo các route con của module cho router của host (mỗi route một lần gọi `createRoute`). */
export function createCommunityRoutes<Parent, Route, Component>(
  host: RouteHost<Parent, Route, Component>,
): Route[] {
  const component = host.lazy(loadCommunityPage);
  return communityRoutes.map((r) =>
    host.createRoute({
      getParentRoute: () => host.parent,
      path: r.path,
      component,
      validateSearch: validateCommunitySearch,
    }),
  );
}

export const communityManifest = {
  key: COMMUNITY_PACK,
  base: COMMUNITY_BASE,
  routes: communityRoutes,
} as const;
