// HUB-FR-60 · HUB-FR-62 · gọi API Studio cho màn Agents (component không fetch — đi qua hooks/).
import type {
  Agent,
  AgentList,
  AgentRuntime,
  AgentTypeListSchema,
  AgentWriteResponse,
  ModelProfileListSchema,
  OrchestratorInput,
  OrchestratorList,
  OrchestratorWriteResponse,
  WorkflowListSchema,
} from "@ai/contracts/studio";
import { queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "#/lib/http";

type AgentTypeList = z.infer<typeof AgentTypeListSchema>;
type ModelProfileList = z.infer<typeof ModelProfileListSchema>;
type WorkflowList = z.infer<typeof WorkflowListSchema>;

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

export const agentQuery = (id: string) =>
  queryOptions({
    queryKey: [...AGENTS_KEY, "detail", id] as const,
    queryFn: ({ signal }) => api<Agent>(`/studio/api/agents/${id}`, { signal }),
    staleTime: 0,
    gcTime: 0,
  });

export const modelProfilesQuery = queryOptions({
  queryKey: ["studio", "model-profiles"] as const,
  queryFn: ({ signal }) => api<ModelProfileList>("/studio/api/model-profiles", { signal }),
});

export const workflowsQuery = queryOptions({
  queryKey: ["studio", "workflows"] as const,
  queryFn: ({ signal }) => api<WorkflowList>("/studio/api/workflows", { signal }),
});

export const agentTypesQuery = queryOptions({
  queryKey: ["studio", "agent-types"] as const,
  queryFn: ({ signal }) => api<AgentTypeList>("/studio/api/agent-types", { signal }),
});

export const createAgent = (body: Record<string, unknown>) =>
  api<AgentWriteResponse>("/studio/api/agents", { method: "POST", body });

export const updateAgent = (id: string, body: Record<string, unknown>) =>
  api<AgentWriteResponse>(`/studio/api/agents/${id}`, { method: "PUT", body });
