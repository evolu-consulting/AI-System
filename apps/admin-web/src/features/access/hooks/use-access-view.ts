// ADM-FR-35 · M3-R13 · trang Phân quyền: tab + tenant trên URL (`?tab=matrix|check&tenant=<mã>&user=`); platform chưa chọn tenant → không gọi API (D9).
import type { Me } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useTenantOptions } from "@/features/tenants/api";
import { resolveViewedTenant } from "@/lib/viewed-tenant";

const route = getRouteApi("/_authed/access");
export type AccessTab = "matrix" | "check";

export function useAccessView(me: Me | null) {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const options = useTenantOptions(me?.role === "platform_admin");
  const tn = resolveViewedTenant(me, search.tenant, options);
  const patch = (p: Record<string, string | undefined>) =>
    void navigate({ search: (prev) => ({ ...prev, ...p }), replace: true });
  return {
    ...tn,
    user: search.user,
    tab: (search.tab ?? "matrix") as AccessTab,
    needsTenant: tn.isPlatform && !tn.tenantId,
    setTab: (tab: AccessTab) => patch({ tab }),
    setTenant: (key: string | null) => patch({ tenant: key ?? undefined, user: undefined }),
  };
}
