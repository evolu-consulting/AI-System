// CR-112 · ADM-FR-76 · search của `/tenants/$tenantId`: `tab` + bộ lọc của tab Người dùng/Nhóm/Đối tác/Phân quyền (trước đây nằm trên route riêng).
// Viết tay (không zod) vì validateSearch nằm trong bundle ban đầu. Đổi tab ⇒ chỉ giữ `tab` (xem TenantDetailPage).
import { legacyTab, MEMBER_VIEWS, type MemberView, type TenantTab } from "./workspace-tabs";

/** Tab con của Phân quyền: Vai theo ứng dụng (mặc định) / Ma trận / Kiểm tra quyền. */
export type AccessMode = "roles" | "matrix" | "check";
const ACCESS_MODES: readonly AccessMode[] = ["roles", "matrix", "check"];

export type WorkspaceSearch = {
  tab?: TenantTab;
  q?: string;
  status?: "active" | "locked";
  role?: "platform_admin" | "tenant_admin" | "member";
  login?: "never";
  /** Key group (`?group=ke-toan`) — bộ lọc tab Người dùng. */
  group?: string;
  page?: number;
  drawer?: "new" | "edit";
  user?: string;
  /** CR-121 c12 (Q5) · mở ngăn Gán của việc này khi vào tab Quy trình (`?tab=processes&job=<khoá việc>`). */
  job?: string;
  /** Id công ty đối tác đang mở drawer (tab Đối tác). */
  org?: string;
  /** CR-121 c14 · mục con của tab Thành viên (Người dùng mặc định · Nhóm · Đối tác · Phân quyền · Agents). */
  view?: MemberView;
  /** Tab con trong mục Phân quyền (trước đây là `view`). */
  mode?: AccessMode;
  /** CR-121 c14 · cuộn tới phần trong tab (`?tab=settings&at=quota`, thay `?tab=quota`). */
  at?: "quota";
  /** CR-121 c16 · `?tab=workflow-tools` cũ (tab đã gỡ) — route chuyển tới /ai-tools. */
  legacy?: "workflow-tools";
};

/** URL cũ → nơi mới (R2): `?tab=workflow-tools` ⇒ Công cụ AI kèm thông báo; còn lại không chuyển. */
export function legacyTabRedirect(
  s: WorkspaceSearch,
): { to: "/ai-tools"; notice: "company-tools" } | null {
  return s.legacy === "workflow-tools" ? { to: "/ai-tools", notice: "company-tools" } : null;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

export function validateWorkspaceSearch(s: Record<string, unknown>): WorkspaceSearch {
  const page = Number(s.page);
  // URL cũ (`tab=info|features|users|groups|partners|access|agents|quota|packs`) ⇒ tab mới + mục con (c14).
  const old = legacyTab(s.tab);
  // Phân quyền cũ: `?tab=access&view=matrix|check` ⇒ `mode`.
  const oldAccessMode = s.tab === "access" ? oneOf(s.view, ACCESS_MODES) : undefined;
  return {
    tab: old?.tab,
    q: str(s.q),
    status: oneOf(s.status, ["active", "locked"]),
    role: oneOf(s.role, ["platform_admin", "tenant_admin", "member"]),
    login: oneOf(s.login, ["never"]),
    group: str(s.group),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    drawer: oneOf(s.drawer, ["new", "edit"]),
    user: str(s.user),
    job: str(s.job),
    org: str(s.org),
    view: oneOf(s.view, MEMBER_VIEWS) ?? old?.view,
    mode: oneOf(s.mode, ACCESS_MODES) ?? oldAccessMode,
    at: old?.at ?? (s.at === "quota" ? "quota" : undefined),
    legacy: s.tab === "workflow-tools" ? "workflow-tools" : undefined,
  };
}
