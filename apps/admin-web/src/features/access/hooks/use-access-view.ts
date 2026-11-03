// ADM-FR-35 · M3-R13 · tab Phân quyền của workspace công ty: tab con + user trên URL (`?tab=access&view=roles|matrix|check&user=`); tenant theo workspace (CR-112).
import type { Me } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useWorkspaceView } from "@/features/tenants/lib/use-workspace-view";

const route = getRouteApi("/_authed/tenants/$tenantId");
export type AccessTab = "roles" | "matrix" | "check";

export function useAccessView(me: Me | null) {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const tn = useWorkspaceView(me);
  const patch = (p: Record<string, string | undefined>) =>
    void navigate({ search: (prev) => ({ ...prev, ...p }), replace: true });
  return {
    ...tn,
    user: search.user,
    tab: (search.view ?? "roles") as AccessTab,
    needsTenant: tn.isPlatform && !tn.tenantId,
    setTab: (view: AccessTab) => patch({ view }),
    setUser: (user: string | undefined) => patch({ user }),
  };
}
