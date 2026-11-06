// CR-112 · ADM-FR-76 AC2/AC3 · route cũ `/users`, `/groups`, `/partners`, `/access`, `/agents` (tenant_admin) → tab tương ứng của workspace công ty.
// tenant_admin: công ty mình. platform_admin: `?tenant=<mã>` nếu có, không thì công ty chọn gần nhất; chưa có ⇒ danh sách công ty. Giữ nguyên query khác.
import { validateWorkspaceSearch, type WorkspaceSearch } from "./workspace-search";
import type { TenantTab } from "./workspace-tabs";

export type LegacyTab = Extract<TenantTab, "users" | "groups" | "partners" | "access" | "agents">;

export type LegacyContext = {
  role: "platform_admin" | "tenant_admin" | "member" | undefined;
  ownTenantId: string | undefined;
  lastTenantId: string | undefined;
  /** Mã công ty → id (platform_admin); `undefined` = mã lạ hay chưa có danh sách. */
  idForKey: (key: string) => string | undefined;
};

export type LegacyTarget =
  | { to: "/tenants" }
  | { to: "/tenants/$tenantId"; params: { tenantId: string }; search: WorkspaceSearch };

/** Tenant cần tra (chỉ platform_admin gửi `?tenant=<mã>`). */
export function legacyTenantKey(role: LegacyContext["role"], search: Record<string, unknown>) {
  const k = search.tenant;
  return role === "platform_admin" && typeof k === "string" && k !== "" ? k : undefined;
}

export function legacyTarget(
  tab: LegacyTab,
  search: Record<string, unknown>,
  ctx: LegacyContext,
): LegacyTarget {
  const key = legacyTenantKey(ctx.role, search);
  const tenantId =
    ctx.role === "tenant_admin"
      ? ctx.ownTenantId
      : ctx.role === "platform_admin"
        ? key
          ? ctx.idForKey(key)
          : ctx.lastTenantId
        : undefined;
  if (!tenantId) return { to: "/tenants" };
  // Phân quyền cũ dùng `?tab=matrix|check` cho tab con → `view`; mọi tab khác bỏ `tab` cũ.
  const { tenant: _tenant, tab: oldTab, ...rest } = search;
  const carried = tab === "access" ? { ...rest, view: oldTab } : rest;
  return {
    to: "/tenants/$tenantId",
    params: { tenantId },
    search: { ...validateWorkspaceSearch(carried), tab },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CR-121 c13 (R2/R7) · `/processes` không còn chỗ gán: tenant_admin ⇒ Quy trình của công ty MÌNH; platform_admin vào
 * `/processes?tenant=<id>` (chỉ có công ty, không kèm bộ lọc thư viện) ⇒ Quy trình của công ty đó. Trả id công ty, hoặc null = ở lại thư viện.
 */
export function processesRedirectTenant(
  role: LegacyContext["role"],
  search: Record<string, unknown>,
  ownTenantId: string | undefined,
): string | null {
  if (role === "tenant_admin") return ownTenantId ?? null;
  if (role !== "platform_admin") return null;
  const t = search.tenant;
  const onlyTenant = !search.app && !search.slot && !search.status && !search.tab;
  return typeof t === "string" && UUID_RE.test(t) && onlyTenant ? t : null;
}
