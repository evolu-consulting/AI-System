// HUB-FR-62 · H4a-R07 · API Orchestrator theo tenant + danh sách tenant (bản mặc định dùng chung api của Agents).
import type { OrchestratorInput, OrchestratorWriteResponse } from "@ai/contracts/studio";
import { queryOptions } from "@tanstack/react-query";
import { api } from "#/lib/http";
import type { TenantItem } from "./lib/draft";

export { orchestratorQuery, putOrchestratorDefault } from "#/features/agents/api";

export const tenantsQuery = queryOptions({
  queryKey: ["studio", "tenants"] as const,
  queryFn: ({ signal }) =>
    api<{ items: TenantItem[] }>("/studio/api/tenants", { signal }).then((r) => r.items),
  staleTime: 0,
});

export const createTenantOrch = (body: OrchestratorInput & { tenant_id: string }) =>
  api<OrchestratorWriteResponse>("/studio/api/orchestrator/tenants", { method: "POST", body });

export const updateTenantOrch = (tenantId: string, body: OrchestratorInput & { version: number }) =>
  api<OrchestratorWriteResponse>(`/studio/api/orchestrator/tenants/${tenantId}`, {
    method: "PUT",
    body,
  });

export const deleteTenantOrch = (tenantId: string, version: number) =>
  api<{ hub_config_version?: number } | undefined>(`/studio/api/orchestrator/tenants/${tenantId}`, {
    method: "DELETE",
    query: { version },
  });
