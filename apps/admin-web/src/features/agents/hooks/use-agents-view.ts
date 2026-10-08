// HUB-FR-77 · CR-054 · dữ liệu màn Agents: tenant đang xem (platform chọn qua `?tenant=<mã>`) + cài đặt agent + grant từ Hub.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { resolveViewedTenant } from "@/lib/viewed-tenant";
import { useAgentSettings, useTenantAgentGrants } from "../api";

const route = getRouteApi("/_authed/agents");

export function useAgentsView() {
  const me = useSession((s) => s.me);
  const search = route.useSearch();
  const navigate = useNavigate();
  const options = useTenantOptions(me?.role === "platform_admin");
  const tn = resolveViewedTenant(me, search.tenant, options);
  const needsTenant = tn.isPlatform && !tn.tenantId;
  const enabled = !!me && tn.ready && !needsTenant;
  const settings = useAgentSettings(tn.tenantId, enabled);
  const grants = useTenantAgentGrants(tn.tenantId, enabled);
  const grantRows = useMemo(
    () => new Map((grants.data?.items ?? []).map((i) => [i.agent.id, i.grants])),
    [grants.data],
  );
  return {
    me,
    ...tn,
    needsTenant,
    settings,
    grants,
    grantRows,
    /** Tenant id thật (cho grant `tenant`): Hub trả kèm danh sách grant. */
    grantTenantId: grants.data?.tenant_id ?? tn.tenantId,
    setTenant: (key: string | null) =>
      void navigate({ to: "/agents", search: { tenant: key ?? undefined }, replace: true }),
  };
}

export type AgentsView = ReturnType<typeof useAgentsView>;
