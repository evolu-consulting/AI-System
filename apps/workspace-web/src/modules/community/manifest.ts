// CR-118 · COM-FR-31 (MODIFIED) · manifest module Community — dữ liệu route + nhà máy cây route tương thích TanStack Router.
// Shell chỉ đọc file này (luật web-shell-manifest-only). KHÔNG khởi tạo router ở đây: host truyền `createRoute` + route cha
// (`createRoute` của @tanstack/react-router, `lazyRouteComponent` làm `lazy`). Trang tải lười ⇒ module tắt không có chunk.
import { ClipboardCheck, Flag, Newspaper, PenLine, User, UserPlus } from "lucide-react";
import type { ComponentType } from "react";
import type { ModuleManifest } from "~/shared/kernel/module-manifest";
import { type CommunityHostConfig, setCommunityHost } from "./application/host";
import { COMMUNITY_BASE } from "./domain/base";

export type CommunityRouteId =
  | "feed"
  | "profile"
  | "profileOrg"
  | "profileSection"
  | "me"
  | "meSection"
  | "review"
  | "join"
  | "reports";
export type PageLoader = () => Promise<{ default: ComponentType }>;
export type CommunityRouteDef = { id: CommunityRouteId; path: string };
export type { LowRouter } from "./application/router-port";
export type { CommunityHostConfig };

/** Khoá gói quyền (FeatureGate) của module. */
export const COMMUNITY_PACK = "community";

/** Route con tương đối dưới `/community` (khung); `?settings=1` mở hộp thoại Cài đặt, không phải route. Giữ gọn: nằm trong bundle đầu. */
const CHILD_PATHS = [
  "/",
  "/profile",
  "/profile/$orgId",
  "/profile/$orgId/$section",
  "/me",
  "/me/$section",
  "/review",
  "/join",
  "/reports",
] as const;

/** Route của module (đường dẫn tuyệt đối từ gốc router). */
export const communityRoutes: readonly CommunityRouteDef[] = CHILD_PATHS.map((p, i) => ({
  id: (
    [
      "feed",
      "profile",
      "profileOrg",
      "profileSection",
      "me",
      "meSection",
      "review",
      "join",
      "reports",
    ] as const
  )[i] as CommunityRouteId,
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

/**
 * CR-120 · nhóm menu trái + mục menu tài khoản của Community, đọc bởi AppShell dùng chung (thay Sidebar/UserMenu riêng của module).
 * `/community/profile` (không orgId) = hồ sơ của mình ⇒ "Bài đăng của tôi" / "Tường nhà".
 */
export const communityManifest = {
  key: COMMUNITY_PACK,
  basePath: COMMUNITY_BASE,
  base: COMMUNITY_BASE,
  home: COMMUNITY_BASE,
  requires: { pack: COMMUNITY_PACK, action: "read" as const },
  routes: communityRoutes,
  groupLabelKey: "contracts.nav.group.community",
  order: 20,
  nav: [
    {
      to: COMMUNITY_BASE,
      labelKey: "contracts.nav.feed",
      icon: Newspaper,
      exact: true,
      testId: "nav-community",
      mobile: "primary",
    },
    {
      to: `${COMMUNITY_BASE}/me`,
      labelKey: "contracts.nav.myProfile",
      icon: PenLine,
      bottom: false,
    },
    // CR-120: 3 màn của luồng — chỉ hiện đúng vai và khi khe đã bật (cap do server tính, shell/use-flow-caps).
    {
      to: `${COMMUNITY_BASE}/review`,
      labelKey: "contracts.nav.review",
      icon: ClipboardCheck,
      testId: "nav-community-review",
      cap: "community.review",
      bottom: false,
    },
    {
      to: `${COMMUNITY_BASE}/join`,
      labelKey: "contracts.nav.join",
      icon: UserPlus,
      testId: "nav-community-join",
      cap: "community.join",
      bottom: false,
    },
    {
      to: `${COMMUNITY_BASE}/reports`,
      labelKey: "contracts.nav.reports",
      icon: Flag,
      testId: "nav-community-reports",
      cap: "community.reports",
      bottom: false,
    },
  ],
  accountMenu: [
    { to: `${COMMUNITY_BASE}/me`, labelKey: "contracts.shell.menuProfile", icon: User },
  ],
} as const;

/** Kiểm kiểu: manifest Community thoả hợp đồng chung của shell (phần thừa `base`/`routes` là của riêng module). */
export const communityShellManifest: ModuleManifest = communityManifest;

/** CR-130 · ngăn "Bảng tin › Thông báo" của Cài đặt Sổ Hợp Tác (hộp thoại chung nạp lười khi gói Cộng đồng bật). */
export const loadFeedSettingsPane = () =>
  import(/* webpackChunkName: "cm-settings" */ "./ui/settings/FeedNotifyPane");

/** CR-130 · link cũ `/community?settings=1` (menu tài khoản cũ, `#/settings`): nay mở Cài đặt chung ở mục Bảng tin. */
export const isLegacySettingsLink = (search: unknown): boolean =>
  typeof search === "object" &&
  search !== null &&
  String((search as { settings?: unknown }).settings) === "1";
