// ADM-FR-60, ADM-FR-04, ADM-FR-10 · mục menu theo role: Tổng quan; TRUY CẬP: Tenants (chỉ platform_admin), Users; HỆ THỐNG (cuối, M4): Chi phí & quota, Nhật ký (cả hai role), Import / Export (chỉ platform_admin).
// CR-054: CHỨC NĂNG có Agents (cả hai role; tenant_admin chỉ thấy Agents trong nhóm này).
// TRUY CẬP gồm cả Groups và Phân quyền (M3, tenant_admin cũng thấy); CHỨC NĂNG (trên TRUY CẬP, plan-frontend D3): Features, Commands, Workflows; BẢO MẬT (dưới cùng): Secrets (M2, chỉ platform_admin).
import type { Role } from "@ai/contracts";

export type NavId =
  | "overview"
  | "agents"
  | "tenants"
  | "users"
  | "features"
  | "commands"
  | "workflows"
  | "groups"
  | "access"
  | "secrets"
  | "usage"
  | "audit"
  | "transfer";
type NavTo =
  | "/"
  | "/agents"
  | "/tenants"
  | "/users"
  | "/groups"
  | "/access"
  | "/features"
  | "/commands"
  | "/workflows"
  | "/secrets"
  | "/usage"
  | "/audit"
  | "/transfer";
export type NavItem = {
  id: NavId;
  to: NavTo;
  labelKey:
    | "nav.overview"
    | "nav.agents"
    | "nav.tenants"
    | "nav.users"
    | "nav.features"
    | "nav.commands"
    | "nav.workflows"
    | "nav.groups"
    | "nav.access"
    | "nav.secrets"
    | "nav.usage"
    | "nav.audit"
    | "nav.transfer";
};
export type NavGroup = {
  labelKey:
    | "nav.group.access"
    | "nav.group.features"
    | "nav.group.security"
    | "nav.group.system"
    | null;
  items: NavItem[];
};

const item = (id: NavId, to: NavTo): NavItem => ({ id, to, labelKey: `nav.${id}` });
const OVERVIEW = item("overview", "/");
const TENANTS = item("tenants", "/tenants");
const USERS = item("users", "/users");
const AGENTS = item("agents", "/agents");
const FEATURES = item("features", "/features");
const COMMANDS = item("commands", "/commands");
const WORKFLOWS = item("workflows", "/workflows");
const GROUPS = item("groups", "/groups");
const ACCESS = item("access", "/access");
const SECRETS = item("secrets", "/secrets");
const USAGE = item("usage", "/usage");
const AUDIT = item("audit", "/audit");
const TRANSFER = item("transfer", "/transfer");

/** Menu theo role. `member` không dùng khung quản trị nên không có mục nào. */
export function navGroups(role: Role | undefined): NavGroup[] {
  if (role === "platform_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.features", items: [AGENTS, FEATURES, COMMANDS, WORKFLOWS] },
      { labelKey: "nav.group.access", items: [TENANTS, USERS, GROUPS, ACCESS] },
      { labelKey: "nav.group.security", items: [SECRETS] },
      { labelKey: "nav.group.system", items: [USAGE, AUDIT, TRANSFER] },
    ];
  }
  if (role === "tenant_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.features", items: [AGENTS] },
      { labelKey: "nav.group.access", items: [USERS, GROUPS, ACCESS] },
      { labelKey: "nav.group.system", items: [USAGE, AUDIT] },
    ];
  }
  return [];
}

export type Crumb = {
  labelKey:
    | NavItem["labelKey"]
    | "tenants.new.title"
    | "account.changePassword"
    | "account.twofa"
    | "workflows.editor.titleNew"
    | "commands.editor.titleNew"
    | "groups.editor.titleNew"
    | "features.editor.titleNew";
  to?: string;
};

const CATALOG: Record<string, { labelKey: NavItem["labelKey"]; newKey: Crumb["labelKey"] }> = {
  workflows: { labelKey: "nav.workflows", newKey: "workflows.editor.titleNew" },
  commands: { labelKey: "nav.commands", newKey: "commands.editor.titleNew" },
  features: { labelKey: "nav.features", newKey: "features.editor.titleNew" },
  groups: { labelKey: "nav.groups", newKey: "groups.editor.titleNew" },
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
  if (pathname === "/agents") return [{ labelKey: "nav.agents" }];
  if (pathname === "/access") return [{ labelKey: "nav.access" }];
  if (pathname === "/secrets") return [{ labelKey: "nav.secrets" }];
  if (pathname === "/account/password") return [{ labelKey: "account.changePassword" }];
  if (pathname === "/account/2fa") return [{ labelKey: "account.twofa" }];
  if (pathname === "/usage") return [{ labelKey: "nav.usage" }];
  if (pathname === "/transfer") return [{ labelKey: "nav.transfer" }];
  if (pathname === "/audit") return [{ labelKey: "nav.audit" }];
  if (pathname.startsWith("/audit/")) return [{ labelKey: "nav.audit", to: "/audit" }];
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
