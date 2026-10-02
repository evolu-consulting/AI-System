// ADM-FR-62 · gọi API /admin/groups* (nơi duy nhất của feature groups) dưới dạng hook TanStack Query.
import type {
  Group,
  GroupCreateRequest,
  GroupListItem,
  GroupListResponse,
  GroupUpdateRequest,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const GROUPS_PAGE_SIZE = 50;

export type GroupListParams = { tenantId?: string; q: string; offset: number };

export const GROUP_KEYS = {
  all: ["groups"] as const,
  list: (p: GroupListParams) => ["groups", "list", p] as const,
  detail: (id: string) => ["groups", "detail", id] as const,
};

export function useGroupList(params: GroupListParams, enabled: boolean) {
  return useQuery({
    queryKey: GROUP_KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<GroupListResponse>("/admin/groups", {
        query: {
          tenant_id: params.tenantId,
          q: params.q || undefined,
          limit: GROUPS_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (g: Pick<GroupListItem | Group, "id">) =>
      api<undefined>(`/admin/groups/${g.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}

export function useGroup(id: string | undefined) {
  return useQuery({
    queryKey: GROUP_KEYS.detail(id ?? ""),
    enabled: !!id,
    queryFn: () => api<Group>(`/admin/groups/${id}`),
  });
}

export function useCreateGroup(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupCreateRequest) =>
      api<Group>("/admin/groups", { method: "POST", body, query: { tenant_id: tenantId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}

export function useUpdateGroup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupUpdateRequest) =>
      api<Group>(`/admin/groups/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}
