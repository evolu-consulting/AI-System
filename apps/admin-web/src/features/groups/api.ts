// ADM-FR-62 · gọi API /admin/groups* (nơi duy nhất của feature groups) dưới dạng hook TanStack Query.
import type { Group, GroupListItem, GroupListResponse } from "@ai/contracts";
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
