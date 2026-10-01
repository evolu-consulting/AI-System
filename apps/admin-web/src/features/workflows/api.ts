// ADM-FR-10, ADM-FR-13, ADM-FR-14, ADM-FR-15 · gọi API /admin/workflows* (nơi duy nhất) dưới dạng hook TanStack Query.
import type {
  SecretListResponse,
  Workflow,
  WorkflowCreateRequest,
  WorkflowListResponse,
  WorkflowUpdateRequest,
  WorkflowUsages,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const WORKFLOWS_PAGE_SIZE = 50;
const USAGES_STALE_MS = 30_000;

export type WorkflowStatusFilter = "on" | "off" | "unattached";
export type WorkflowListParams = {
  q: string;
  status?: WorkflowStatusFilter;
  secret?: string;
  offset: number;
};

export const WORKFLOW_KEYS = {
  all: ["workflows"] as const,
  list: (p: WorkflowListParams) => ["workflows", "list", p] as const,
  usages: (id: string) => ["workflows", "usages", id] as const,
  detail: (id: string) => ["workflows", "detail", id] as const,
  secrets: ["workflows", "secret-options"] as const,
};

/** Chip `Chưa gắn` → `attached=false` (không gửi `status`); `Bật/Tắt` → `status`. */
function listQuery(p: WorkflowListParams) {
  return {
    q: p.q || undefined,
    status: p.status === "on" || p.status === "off" ? p.status : undefined,
    attached: p.status === "unattached" ? "false" : undefined,
    secret: p.secret,
    limit: WORKFLOWS_PAGE_SIZE,
    offset: p.offset || undefined,
  };
}

export function useWorkflowList(params: WorkflowListParams, enabled: boolean) {
  return useQuery({
    queryKey: WORKFLOW_KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api<WorkflowListResponse>("/admin/workflows", { query: listQuery(params) }),
  });
}

export const fetchWorkflowUsages = (id: string) =>
  api<WorkflowUsages>(`/admin/workflows/${id}/usages`);

/** `usages` chỉ nạp khi mở Popover/tab/dialog (`enabled`), cache 30 s. */
export function useWorkflowUsages(id: string, enabled: boolean) {
  return useQuery({
    queryKey: WORKFLOW_KEYS.usages(id),
    enabled,
    staleTime: USAGES_STALE_MS,
    queryFn: () => fetchWorkflowUsages(id),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: WORKFLOW_KEYS.detail(id ?? ""),
    enabled: !!id,
    queryFn: () => api<Workflow>(`/admin/workflows/${id}`),
  });
}

/** Danh sách secret cho ô chọn (giá trị = `id`); chỉ tên và `last4`, không bao giờ có giá trị. */
export function useSecretOptions() {
  return useQuery({
    queryKey: WORKFLOW_KEYS.secrets,
    staleTime: USAGES_STALE_MS,
    queryFn: async () => {
      const res = await api<SecretListResponse>("/admin/secrets", { query: { limit: 200 } });
      return res.items.map((s) => ({ id: s.id, name: s.name }));
    },
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowCreateRequest) =>
      api<Workflow>("/admin/workflows", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.all }),
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & WorkflowUpdateRequest) =>
      api<Workflow>(`/admin/workflows/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.all }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/admin/workflows/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKFLOW_KEYS.all }),
  });
}
