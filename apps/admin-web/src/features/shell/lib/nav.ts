// ADM-FR-60, ADM-FR-04, ADM-FR-10 · mục menu theo role: Tổng quan; TRUY CẬP: Tenants (chỉ platform_admin), Users; HỆ THỐNG (cuối, M4): Chi phí & quota, Nhật ký (cả hai role), Import / Export (chỉ platform_admin).
// CR-060 (P-b FS1): CHỨC NĂNG có thêm Nguồn (`/sources`, cả hai role, cùng cờ engine với Quy trình).
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
  | "processes"
  | "sources"
  | "workflowSteps"
  | "workflowProcess"
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
  | "/processes"
  | "/sources"
  | "/workflows/steps"
  | "/secrets"
  | "/usage"
  | "/audit"
  | "/transfer";
export type NavItem = {
  id: NavId;
  to: NavTo;
  /** DLC-R15 · mục có menu con sổ xuống (Workflows → Workflow Steps · Workflow Process). */
  children?: NavItem[];
  labelKey:
    | "nav.overview"
    | "nav.agents"
    | "nav.tenants"
    | "nav.users"
    | "nav.features"
    | "nav.commands"
    | "nav.workflows"
    | "nav.processes"
    | "nav.sources"
    | "nav.workflowSteps"
    | "nav.workflowProcess"
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
// DLC-R15 · Workflows sổ xuống: Steps (các bước AI SDLC) · Process (danh sách flow Dify + flow AI SDLC).
const WORKFLOWS: NavItem = {
  ...item("workflows", "/workflows"),
  children: [item("workflowSteps", "/workflows/steps"), item("workflowProcess", "/workflows")],
};
const PROCESSES = item("processes", "/processes");
const SOURCES = item("sources", "/sources");
const GROUPS = item("groups", "/groups");
const ACCESS = item("access", "/access");
const SECRETS = item("secrets", "/secrets");
const USAGE = item("usage", "/usage");
const AUDIT = item("audit", "/audit");
const TRANSFER = item("transfer", "/transfer");

/** Tuỳ chọn bật mục theo cờ: `processes` = engine quy trình `on` (P-a FD2) — mặc định ẩn; kéo theo mục "Nguồn" (P-b FS1). */
export type NavOptions = { processes?: boolean };

/** Menu theo role. `member` không dùng khung quản trị nên không có mục nào. Mục "Quy trình" (CHỨC NĂNG, cả hai role) chỉ khi `opts.processes`. */
export function navGroups(role: Role | undefined, opts: NavOptions = {}): NavGroup[] {
  const proc = opts.processes ? [PROCESSES, SOURCES] : [];
  if (role === "platform_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.features", items: [AGENTS, FEATURES, COMMANDS, WORKFLOWS, ...proc] },
      { labelKey: "nav.group.access", items: [TENANTS, USERS, GROUPS, ACCESS] },
      { labelKey: "nav.group.security", items: [SECRETS] },
      { labelKey: "nav.group.system", items: [USAGE, AUDIT, TRANSFER] },
    ];
  }
  if (role === "tenant_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.features", items: [AGENTS, ...proc] },
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
    | "features.editor.titleNew"
    | "nav.processesNew";
  to?: string;
};

const CATALOG: Record<string, { labelKey: NavItem["labelKey"]; newKey: Crumb["labelKey"] }> = {
  workflows: { labelKey: "nav.workflows", newKey: "workflows.editor.titleNew" },
  commands: { labelKey: "nav.commands", newKey: "commands.editor.titleNew" },
  features: { labelKey: "nav.features", newKey: "features.editor.titleNew" },
  groups: { labelKey: "nav.groups", newKey: "groups.editor.titleNew" },
  // D3 (UAT 2026-10-11): dùng khoá base (luôn nạp) cho breadcrumb — `process.admin.*` nạp lười nên shell lộ khoá thô.
  processes: { labelKey: "nav.processes", newKey: "nav.processesNew" },
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

/** Breadcrumb của đường dẫn khớp chính xác (không phải danh sách/editor M2). */
const EXACT_CRUMBS: Record<string, Crumb[]> = {
  "/": [{ labelKey: "nav.overview" }],
  "/users": [{ labelKey: "nav.users" }],
  "/agents": [{ labelKey: "nav.agents" }],
  "/access": [{ labelKey: "nav.access" }],
  "/sources": [{ labelKey: "nav.sources" }],
  "/secrets": [{ labelKey: "nav.secrets" }],
  "/account/password": [{ labelKey: "account.changePassword" }],
  "/account/2fa": [{ labelKey: "account.twofa" }],
  "/usage": [{ labelKey: "nav.usage" }],
  "/transfer": [{ labelKey: "nav.transfer" }],
  "/audit": [{ labelKey: "nav.audit" }],
  "/workflows/steps": [
    { labelKey: "nav.workflows", to: "/workflows" },
    { labelKey: "nav.workflowSteps" },
  ],
  "/tenants": [{ labelKey: "nav.tenants" }],
  "/tenants/new": [{ labelKey: "nav.tenants", to: "/tenants" }, { labelKey: "tenants.new.title" }],
};

/** Breadcrumb theo đường dẫn hiện tại. */
export function crumbsFor(pathname: string): Crumb[] {
  const exact = EXACT_CRUMBS[pathname];
  if (exact) return exact;
  if (pathname.startsWith("/audit/")) return [{ labelKey: "nav.audit", to: "/audit" }];
  if (pathname.startsWith("/tenants/")) return [{ labelKey: "nav.tenants", to: "/tenants" }];
  return catalogCrumbs(pathname.replace(/\/$/, ""));
}

/** Role `member` chỉ được vào các đường dẫn này (còn lại → /member). */
const MEMBER_ALLOWED = new Set(["/member", "/account/password"]);

export function isAllowedForRole(role: Role, pathname: string): boolean {
  return role !== "member" || MEMBER_ALLOWED.has(pathname);
}
