// ADM-FR-60, ADM-FR-61 · gọi API /admin/tenants* (nơi duy nhất) dưới dạng hook TanStack Query.
import type {
  TenantCreateRequest,
  TenantCreateResponse,
  TenantDetail,
  TenantListResponse,
  TenantUpdateRequest,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export type TenantListParams = { q: string; status?: "active" | "locked" };

const KEYS = {
  all: ["tenants"] as const,
  list: (p: TenantListParams) => ["tenants", "list", p] as const,
  detail: (id: string) => ["tenants", "detail", id] as const,
};

/** Tenant ≤ 200 → lấy một lần; lọc trạng thái do server (`status`), số chip lấy từ `counts` của response. */
export function useTenantList(params: TenantListParams, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<TenantListResponse>("/admin/tenants", {
        query: { limit: 200, q: params.q || undefined, status: params.status },
      }),
  });
}

export function useTenantDetail(id: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.detail(id),
    enabled,
    queryFn: () => api<TenantDetail>(`/admin/tenants/${id}`),
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TenantCreateRequest) =>
      api<TenantCreateResponse>("/admin/tenants", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useUpdateTenant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TenantUpdateRequest) =>
      api<TenantDetail>(`/admin/tenants/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

/** Khoá/mở khoá ảnh hưởng cả user của tenant → làm mới cả danh sách user. */
export function useSetTenantLocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
      api<TenantDetail>(`/admin/tenants/${id}/${locked ? "lock" : "unlock"}`, { method: "POST" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.all });
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
