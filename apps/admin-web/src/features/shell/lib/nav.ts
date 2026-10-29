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
  | "partners"
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
  | "apps"
  | "usage"
  | "audit"
  | "feedback"
  | "transfer";
type NavTo =
  | "/"
  | "/agents"
  | "/tenants"
  | "/users"
  | "/partners"
  | "/groups"
  | "/access"
  | "/features"
  | "/commands"
  | "/workflows"
  | "/processes"
  | "/sources"
  | "/workflows/steps"
  | "/secrets"
  | "/apps"
  | "/usage"
  | "/audit"
  | "/feedback"
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
    | "nav.partners"
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
    | "nav.apps"
    | "nav.usage"
    | "nav.audit"
    | "nav.feedback"
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
const PARTNERS = item("partners", "/partners");
const AGENTS = item("agents", "/agents");
const FEATURES = item("features", "/features");
const COMMANDS = item("commands", "/commands");
// DLC-R15 · Workflows sổ xuống: Steps (các bước AI SDLC) · Process (danh sách flow Dify + flow AI SDLC).
const WORKFLOWS: NavItem = {
  ...item("workflows", "/workflows"),
  children: [item("workflowSteps", "/workflows/steps"), item("workflowProcess", "/workflows")],
};
// Cờ đóng băng off: chỉ danh mục Workflow Dify, không có menu con của engine quy trình.
const WORKFLOWS_CATALOG = item("workflows", "/workflows");
const PROCESSES = item("processes", "/processes");
const SOURCES = item("sources", "/sources");
const GROUPS = item("groups", "/groups");
const ACCESS = item("access", "/access");
const SECRETS = item("secrets", "/secrets");
const APPS = item("apps", "/apps");
const USAGE = item("usage", "/usage");
const AUDIT = item("audit", "/audit");
const FEEDBACK = item("feedback", "/feedback");
const TRANSFER = item("transfer", "/transfer");

/** Tuỳ chọn bật mục theo cờ: `processes` = engine quy trình `on` (P-a FD2) — mặc định ẩn; kéo theo mục "Nguồn" (P-b FS1). */
export type NavOptions = {
  processes?: boolean;
  /** F1 (CR-095) · `false` ⇒ ẩn mục module đóng băng (Transfer, Quy trình, Nguồn, Workflow Steps; Commands + danh mục Workflows luôn hiện). Vắng ⇒ hiện (test); SidebarNav truyền cờ build. */
  frozen?: boolean;
};

/** Đường dẫn của module đóng băng: cờ off ⇒ guard `_authed` chuyển về `/`. */
// dify-workflows: danh mục Workflow Dify (/workflows, editor, lịch sử chạy) KHÔNG đóng băng; chỉ /workflows/steps (engine AI SDLC) bị gate.
// CR-103 · `/processes*` KHÔNG còn gate theo cờ build: Hub quyết lúc chạy (`HUB_PROCESS_ROUTES=admin` ⇒ dò `/process-defs` 200);
// `ProcessRouteGate` vẽ NotFound khi Hub báo off. `/sources` vẫn đóng băng (Hub không mount nguồn ở chế độ admin).
const FROZEN_PREFIXES = ["/workflows/steps", "/transfer", "/sources"];
export const isFrozenPath = (pathname: string): boolean =>
  FROZEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Menu theo role. `member` không dùng khung quản trị nên không có mục nào. Mục "Quy trình" (CHỨC NĂNG, cả hai role) chỉ khi `opts.processes`. */
export function navGroups(role: Role | undefined, opts: NavOptions = {}): NavGroup[] {
  const on = opts.frozen !== false;
  // CR-103 · "Quy trình" theo Hub (dò lúc chạy) kể cả khi cờ build đóng băng off; "Nguồn" vẫn cần cờ build on.
  const proc = opts.processes ? [PROCESSES, ...(on ? [SOURCES] : [])] : [];
  if (role === "platform_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      {
        labelKey: "nav.group.features",
        items: [
          AGENTS,
          FEATURES,
          APPS,
          ...(on ? [COMMANDS, WORKFLOWS] : [COMMANDS, WORKFLOWS_CATALOG]),
          ...proc,
        ],
      },
      { labelKey: "nav.group.access", items: [TENANTS, USERS, PARTNERS, GROUPS, ACCESS] },
      { labelKey: "nav.group.security", items: [SECRETS] },
      { labelKey: "nav.group.system", items: [USAGE, AUDIT, FEEDBACK, ...(on ? [TRANSFER] : [])] },
    ];
  }
  if (role === "tenant_admin") {
    return [
      { labelKey: null, items: [OVERVIEW] },
      { labelKey: "nav.group.features", items: [AGENTS, ...proc] },
      { labelKey: "nav.group.access", items: [USERS, PARTNERS, GROUPS, ACCESS] },
      { labelKey: "nav.group.system", items: [USAGE, AUDIT, FEEDBACK] },
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
    | "nav.processesNew"
    | "nav.usageAnalytics";
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
  "/partners": [{ labelKey: "nav.partners" }],
  "/agents": [{ labelKey: "nav.agents" }],
  "/access": [{ labelKey: "nav.access" }],
  "/sources": [{ labelKey: "nav.sources" }],
  "/secrets": [{ labelKey: "nav.secrets" }],
  "/apps": [{ labelKey: "nav.apps" }],
  "/account/password": [{ labelKey: "account.changePassword" }],
  "/account/2fa": [{ labelKey: "account.twofa" }],
  "/usage": [{ labelKey: "nav.usage" }],
  "/usage/analytics": [{ labelKey: "nav.usage", to: "/usage" }, { labelKey: "nav.usageAnalytics" }],
  "/transfer": [{ labelKey: "nav.transfer" }],
  "/audit": [{ labelKey: "nav.audit" }],
  "/feedback": [{ labelKey: "nav.feedback" }],
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
