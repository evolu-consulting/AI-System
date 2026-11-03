// CR-112 · ADM-FR-76 · search của `/tenants/$tenantId`: `tab` + bộ lọc của tab Người dùng/Nhóm/Đối tác/Phân quyền (trước đây nằm trên route riêng).
// Viết tay (không zod) vì validateSearch nằm trong bundle ban đầu. Đổi tab ⇒ chỉ giữ `tab` (xem TenantDetailPage).
import { TENANT_TABS, type TenantTab } from "./workspace-tabs";

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
  /** Id công ty đối tác đang mở drawer (tab Đối tác). */
  org?: string;
  /** Tab con của Phân quyền: Vai theo ứng dụng (mặc định) / Ma trận / Kiểm tra quyền. */
  view?: "roles" | "matrix" | "check";
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);

export function validateWorkspaceSearch(s: Record<string, unknown>): WorkspaceSearch {
  const page = Number(s.page);
  return {
    tab: oneOf(s.tab, TENANT_TABS),
    q: str(s.q),
    status: oneOf(s.status, ["active", "locked"]),
    role: oneOf(s.role, ["platform_admin", "tenant_admin", "member"]),
    login: oneOf(s.login, ["never"]),
    group: str(s.group),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    drawer: oneOf(s.drawer, ["new", "edit"]),
    user: str(s.user),
    org: str(s.org),
    view: oneOf(s.view, ["roles", "matrix", "check"]),
  };
}
