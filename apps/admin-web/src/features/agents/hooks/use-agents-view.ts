// HUB-FR-77 · CR-054 · dữ liệu màn Agents: tenant đang xem (platform chọn qua `?tenant=<mã>`) + cài đặt agent + grant từ Hub.
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTenantOptions } from "@/features/tenants/api";
import { useWorkspaceTenant } from "@/features/tenants/lib/workspace-context";
import { useSession } from "@/lib/auth/use-session";
import { resolveViewedTenant, resolveWorkspaceTenant } from "@/lib/viewed-tenant";
import { useAgentSettings, useTenantAgentGrants } from "../api";

export function useAgentsView() {
  const me = useSession((s) => s.me);
  // CR-112: trong workspace công ty (tab Agents) tenant theo workspace; trang `/agents` của Nền tảng dùng `?tenant=`.
  const ws = useWorkspaceTenant();
  const search = useSearch({ strict: false }) as { tenant?: string };
  const navigate = useNavigate();
  const options = useTenantOptions(!ws && me?.role === "platform_admin");
  const tn = ws ? resolveWorkspaceTenant(me, ws) : resolveViewedTenant(me, search.tenant, options);
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
    embedded: !!ws,
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
