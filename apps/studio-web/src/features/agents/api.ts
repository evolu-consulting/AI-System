// HUB-FR-60 · HUB-FR-62 · gọi API Studio cho màn Agents (component không fetch — đi qua hooks/).
import type {
  AgentList,
  AgentRuntime,
  AgentWriteResponse,
  OrchestratorInput,
  OrchestratorList,
  OrchestratorWriteResponse,
} from "@ai/contracts/studio";
import { queryOptions } from "@tanstack/react-query";
import { api } from "#/lib/http";

export type AgentListParams = { q?: string; runtime?: AgentRuntime; enabled?: "true" | "false" };

export const AGENTS_KEY = ["studio", "agents"] as const;

export const agentsQuery = (params: AgentListParams = {}) =>
  queryOptions({
    queryKey: [...AGENTS_KEY, params] as const,
    queryFn: ({ signal }) => api<AgentList>("/studio/api/agents", { query: params, signal }),
  });

export const orchestratorQuery = queryOptions({
  queryKey: ["studio", "orchestrator"] as const,
  queryFn: ({ signal }) => api<OrchestratorList>("/studio/api/orchestrator", { signal }),
  staleTime: 0,
});

export const patchAgentEnabled = (id: string, body: { enabled: boolean; version: number }) =>
  api<AgentWriteResponse>(`/studio/api/agents/${id}/enabled`, { method: "PATCH", body });

export const deleteAgent = (id: string, version: number) =>
  api<{ hub_config_version?: number } | undefined>(`/studio/api/agents/${id}`, {
    method: "DELETE",
    query: { version },
  });

export const putOrchestratorDefault = (body: OrchestratorInput & { version: number }) =>
  api<OrchestratorWriteResponse>("/studio/api/orchestrator/default", { method: "PUT", body });
