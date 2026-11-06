// CR-121 · R1 (c10) · sidebar 6 mục phẳng theo artboard `Main`: Tổng quan · Công ty · Ứng dụng · Quy trình · Công cụ AI · Hệ thống. Không nhóm, không tiêu đề nhóm.
// platform_admin thấy đủ 6 (Quy trình chỉ khi engine quy trình bật); tenant_admin: Tổng quan · Công ty (công ty mình) · Quy trình (khi engine bật).
// Features / Commands / Agents / Workflow Dify gộp vào "Công cụ AI" (`/ai-tools?kind=`; c16: trang thật /ai-tools?kind=agent|command lọc theo loại dùng).
// Người dùng / Nhóm / Đối tác / Phân quyền nằm trong workspace công ty; route cũ chuyển hướng (tenants/lib/legacy-redirect.ts).
import type { Role } from "@ai/contracts/common";

export type NavId =
  | "overview"
  | "companies"
  | "apps"
  | "processes"
  | "aiTools"
  | "system"
  | "agents"
  | "tenants"
  | "users"
  | "partners"
  | "features"
  | "commands"
  | "workflows"
  | "dlcSteps"
  | "sources"
  | "groups"
  | "access"
  | "secrets"
  | "usage"
  | "audit"
  | "feedback"
  | "transfer";
type NavTo = "/" | "/tenants" | "/apps" | "/processes" | "/ai-tools" | "/system";
/** Chỉ 6 mục sidebar; các NavId còn lại chỉ để vẽ breadcrumb. */
export type SidebarNavId = "overview" | "companies" | "apps" | "processes" | "aiTools" | "system";
export type NavItem = {
  id: SidebarNavId;
  to: NavTo;
  labelKey:
    | "nav.overview"
    | "nav.companies"
    | "nav.apps"
    | "nav.processes"
    | "nav.aiTools"
    | "nav.system";
};

const item = <I extends SidebarNavId>(id: I, to: NavTo): NavItem => ({
  id,
  to,
  labelKey: `nav.${id}`,
});
const OVERVIEW = item("overview", "/");
const COMPANIES = item("companies", "/tenants");
const APPS = item("apps", "/apps");
const PROCESSES = item("processes", "/processes");
const AI_TOOLS = item("aiTools", "/ai-tools");
const SYSTEM = item("system", "/system");

/** Tuỳ chọn bật mục theo cờ: `processes` = engine quy trình `on` (P-a FD2) — mặc định ẩn. */
export type NavOptions = { processes?: boolean };

/** Đường dẫn của module đóng băng: cờ off ⇒ guard `_authed` chuyển về `/`. */
// dify-workflows: danh mục Workflow Dify (/workflows, editor, lịch sử chạy) KHÔNG đóng băng.
// CR-103 · `/processes*` KHÔNG còn gate theo cờ build: Hub quyết lúc chạy; `/sources` vẫn đóng băng.
const FROZEN_PREFIXES = ["/transfer", "/sources"];
export const isFrozenPath = (pathname: string): boolean =>
  FROZEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Menu phẳng theo role (một danh sách). `member` không dùng khung quản trị nên không có mục nào. */
export function navItems(role: Role | undefined, opts: NavOptions = {}): NavItem[] {
  const proc = opts.processes ? [PROCESSES] : [];
  if (role === "platform_admin") return [OVERVIEW, COMPANIES, APPS, ...proc, AI_TOOLS, SYSTEM];
  // tenant_admin dùng Công ty › Quy trình (CR-121 R2), không có mục Quy trình (thư viện) riêng.
  if (role === "tenant_admin") return [OVERVIEW, COMPANIES, SYSTEM];
  return [];
}

export type Crumb = {
  labelKey:
    | `nav.${NavId}`
    | "tenants.new.title"
    | "account.changePassword"
    | "account.twofa"
    | "workflows.editor.titleNew"
    | "commands.editor.titleNew"
    | "groups.editor.titleNew"
    | "features.editor.titleNew"
    | "nav.processesNew"
    | "system.title"
    | "nav.usageAnalytics";
  to?: string;
};

const CATALOG: Record<string, { labelKey: `nav.${NavId}`; newKey: Crumb["labelKey"] }> = {
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
  "/dlc-steps": [{ labelKey: "nav.dlcSteps" }],
  "/account/password": [{ labelKey: "account.changePassword" }],
  "/account/2fa": [{ labelKey: "account.twofa" }],
  "/usage": [{ labelKey: "nav.usage" }],
  "/usage/analytics": [{ labelKey: "nav.usage", to: "/usage" }, { labelKey: "nav.usageAnalytics" }],
  "/transfer": [{ labelKey: "nav.transfer" }],
  "/system": [{ labelKey: "nav.system" }],
  "/system-health": [{ labelKey: "nav.system", to: "/system" }, { labelKey: "system.title" }],
  "/ai-tools": [{ labelKey: "nav.aiTools" }],
  "/audit": [{ labelKey: "nav.audit" }],
  "/feedback": [{ labelKey: "nav.feedback" }],
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
