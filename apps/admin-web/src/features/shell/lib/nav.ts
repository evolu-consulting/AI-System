// ADM-FR-60, ADM-FR-04 · mục menu M1 theo role (D1/C1): Tổng quan; nhóm TRUY CẬP: Tenants (chỉ platform_admin), Users.
import type { Role } from "@ai/contracts";

export type NavId = "overview" | "tenants" | "users";
export type NavItem = {
  id: NavId;
  to: "/" | "/tenants" | "/users";
  labelKey: "nav.overview" | "nav.tenants" | "nav.users";
};
export type NavGroup = { labelKey: "nav.group.access" | null; items: NavItem[] };

const OVERVIEW: NavItem = { id: "overview", to: "/", labelKey: "nav.overview" };
const TENANTS: NavItem = { id: "tenants", to: "/tenants", labelKey: "nav.tenants" };
const USERS: NavItem = { id: "users", to: "/users", labelKey: "nav.users" };

/** Menu theo role. `member` không dùng khung quản trị nên không có mục nào. */
export function navGroups(role: Role | undefined): NavGroup[] {
  if (role === "platform_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.access", items: [TENANTS, USERS] },
    ];
  }
  if (role === "tenant_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.access", items: [USERS] },
    ];
  }
  return [];
}

export type Crumb = {
  labelKey: NavItem["labelKey"] | "tenants.new.title" | "account.changePassword";
  to?: string;
};

/** Breadcrumb theo đường dẫn hiện tại (chỉ các trang đã có ở M1). */
export function crumbsFor(pathname: string): Crumb[] {
  if (pathname === "/") return [{ labelKey: "nav.overview" }];
  if (pathname === "/users") return [{ labelKey: "nav.users" }];
  if (pathname === "/account/password") return [{ labelKey: "account.changePassword" }];
  if (pathname === "/tenants") return [{ labelKey: "nav.tenants" }];
  if (pathname === "/tenants/new") {
    return [{ labelKey: "nav.tenants", to: "/tenants" }, { labelKey: "tenants.new.title" }];
  }
  if (pathname.startsWith("/tenants/")) return [{ labelKey: "nav.tenants", to: "/tenants" }];
  return [];
}

/** Role `member` chỉ được vào các đường dẫn này (còn lại → /member). */
const MEMBER_ALLOWED = new Set(["/member", "/account/password"]);

export function isAllowedForRole(role: Role, pathname: string): boolean {
  return role !== "member" || MEMBER_ALLOWED.has(pathname);
}
