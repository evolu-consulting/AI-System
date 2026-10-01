// ADM-FR-60, ADM-FR-04, ADM-FR-10 · mục menu theo role: Tổng quan; TRUY CẬP: Tenants (chỉ platform_admin), Users;
// CHỨC NĂNG (trên TRUY CẬP, plan-frontend D3): Features, Commands, Workflows; BẢO MẬT (dưới cùng): Secrets (M2, chỉ platform_admin).
import type { Role } from "@ai/contracts";

export type NavId =
  | "overview"
  | "tenants"
  | "users"
  | "features"
  | "commands"
  | "workflows"
  | "secrets";
type NavTo = "/" | "/tenants" | "/users" | "/features" | "/commands" | "/workflows" | "/secrets";
export type NavItem = {
  id: NavId;
  to: NavTo;
  labelKey:
    | "nav.overview"
    | "nav.tenants"
    | "nav.users"
    | "nav.features"
    | "nav.commands"
    | "nav.workflows"
    | "nav.secrets";
};
export type NavGroup = {
  labelKey: "nav.group.access" | "nav.group.features" | "nav.group.security" | null;
  items: NavItem[];
};

const item = (id: NavId, to: NavTo): NavItem => ({ id, to, labelKey: `nav.${id}` });
const OVERVIEW = item("overview", "/");
const TENANTS = item("tenants", "/tenants");
const USERS = item("users", "/users");
const FEATURES = item("features", "/features");
const COMMANDS = item("commands", "/commands");
const WORKFLOWS = item("workflows", "/workflows");
const SECRETS = item("secrets", "/secrets");

/** Menu theo role. `member` không dùng khung quản trị nên không có mục nào. */
export function navGroups(role: Role | undefined): NavGroup[] {
  if (role === "platform_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.features", items: [FEATURES, COMMANDS, WORKFLOWS] },
      { labelKey: "nav.group.access", items: [TENANTS, USERS] },
      { labelKey: "nav.group.security", items: [SECRETS] },
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
  labelKey:
    | NavItem["labelKey"]
    | "tenants.new.title"
    | "account.changePassword"
    | "workflows.editor.titleNew"
    | "commands.editor.titleNew"
    | "features.editor.titleNew";
  to?: string;
};

const CATALOG: Record<string, { labelKey: NavItem["labelKey"]; newKey: Crumb["labelKey"] }> = {
  workflows: { labelKey: "nav.workflows", newKey: "workflows.editor.titleNew" },
  commands: { labelKey: "nav.commands", newKey: "commands.editor.titleNew" },
  features: { labelKey: "nav.features", newKey: "features.editor.titleNew" },
};

/** Breadcrumb của danh sách và editor M2 (`/workflows`, `/commands/new`, `/features/<id>`). */
function catalogCrumbs(pathname: string): Crumb[] {
  const [, section, rest] = pathname.split("/");
  const entry = CATALOG[section ?? ""];
  if (!entry) return [];
  if (!rest) return [{ labelKey: entry.labelKey }];
  const list = { labelKey: entry.labelKey, to: `/${section}` };
  return rest === "new" ? [list, { labelKey: entry.newKey }] : [list];
}

/** Breadcrumb theo đường dẫn hiện tại. */
export function crumbsFor(pathname: string): Crumb[] {
  if (pathname === "/") return [{ labelKey: "nav.overview" }];
  if (pathname === "/users") return [{ labelKey: "nav.users" }];
  if (pathname === "/secrets") return [{ labelKey: "nav.secrets" }];
  if (pathname === "/account/password") return [{ labelKey: "account.changePassword" }];
  if (pathname === "/tenants") return [{ labelKey: "nav.tenants" }];
  if (pathname === "/tenants/new") {
    return [{ labelKey: "nav.tenants", to: "/tenants" }, { labelKey: "tenants.new.title" }];
  }
  if (pathname.startsWith("/tenants/")) return [{ labelKey: "nav.tenants", to: "/tenants" }];
  return catalogCrumbs(pathname.replace(/\/$/, ""));
}

/** Role `member` chỉ được vào các đường dẫn này (còn lại → /member). */
const MEMBER_ALLOWED = new Set(["/member", "/account/password"]);

export function isAllowedForRole(role: Role, pathname: string): boolean {
  return role !== "member" || MEMBER_ALLOWED.has(pathname);
}
