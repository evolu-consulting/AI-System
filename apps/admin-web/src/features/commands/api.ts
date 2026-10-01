// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-24 · gọi API /admin/commands* (nơi duy nhất) dưới dạng hook TanStack Query.
// Danh sách chọn Feature/Workflow (≤ 200) cũng gọi ở đây vì chỉ Commands dùng.
import type {
  Command,
  CommandCreateRequest,
  CommandListResponse,
  CommandUpdateRequest,
  FeatureListResponse,
  WorkflowListResponse,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const COMMANDS_PAGE_SIZE = 50;
const OPTIONS_STALE_MS = 30_000;
const OPTIONS_LIMIT = 200;

export type CommandListParams = {
  q: string;
  status?: "on" | "off";
  feature?: string;
  workflow?: string;
  offset: number;
};

export const COMMAND_KEYS = {
  all: ["commands"] as const,
  list: (p: CommandListParams) => ["commands", "list", p] as const,
  detail: (id: string) => ["commands", "detail", id] as const,
  features: ["commands", "feature-options"] as const,
  workflows: ["commands", "workflow-options"] as const,
};

export function useCommandList(params: CommandListParams, enabled: boolean) {
  return useQuery({
    queryKey: COMMAND_KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<CommandListResponse>("/admin/commands", {
        query: {
          q: params.q || undefined,
          status: params.status,
          feature: params.feature,
          workflow: params.workflow,
          limit: COMMANDS_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

/** Feature cho ô chọn/lọc (≤ 200); chỉ id, key, tên, trạng thái. */
export function useFeatureOptions(enabled = true) {
  return useQuery({
    queryKey: COMMAND_KEYS.features,
    enabled,
    staleTime: OPTIONS_STALE_MS,
    queryFn: async () => {
      const res = await api<FeatureListResponse>("/admin/features", {
        query: { limit: OPTIONS_LIMIT },
      });
      return res.items.map((f) => ({
        id: f.id,
        key: f.key,
        name: f.name,
        status: f.status,
        isCore: f.is_core,
      }));
    },
  });
}

/** Workflow cho ô chọn/lọc (≤ 200) kèm `total` để biết "chưa có workflow nào". */
export function useWorkflowOptions(enabled = true) {
  return useQuery({
    queryKey: COMMAND_KEYS.workflows,
    enabled,
    staleTime: OPTIONS_STALE_MS,
    queryFn: async () => {
      const res = await api<WorkflowListResponse>("/admin/workflows", {
        query: { limit: OPTIONS_LIMIT },
      });
      return {
        total: res.total,
        items: res.items.map((w) => ({
          id: w.id,
          key: w.key,
          name: w.name,
          description: w.description,
          enabled: w.enabled,
        })),
      };
    },
  });
}

export function useUpdateCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & CommandUpdateRequest) =>
      api<Command>(`/admin/commands/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMMAND_KEYS.all }),
  });
}

export function useCreateCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CommandCreateRequest) =>
      api<Command>("/admin/commands", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMMAND_KEYS.all }),
  });
}

export function useDeleteCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/admin/commands/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: COMMAND_KEYS.all }),
  });
}

export function useCommand(id: string | undefined) {
  return useQuery({
    queryKey: COMMAND_KEYS.detail(id ?? ""),
    enabled: !!id,
    queryFn: () => api<Command>(`/admin/commands/${id}`),
  });
}
