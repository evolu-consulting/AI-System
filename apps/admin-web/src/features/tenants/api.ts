// ADM-FR-60, ADM-FR-61, ADM-FR-40 · gọi API /admin/tenants* (nơi duy nhất) dưới dạng hook TanStack Query.
import type {
  GrantMatrix,
  QuotaSetRequest,
  QuotaSetResponse,
  TenantCreateRequest,
  TenantCreateResponse,
  TenantDetail,
  TenantListResponse,
  TenantUpdateRequest,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { QuotaFeatureOption } from "./lib/quota-draft";

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

/** Danh sách tenant cho ô chọn Tenant (chỉ platform_admin; ánh xạ mã → id); dùng chung cho Groups, Phân quyền. */
export function useTenantOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["tenants", "options"] as const,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<TenantListResponse>("/admin/tenants", { query: { limit: 200 } });
      return res.items.map((t) => ({ id: t.id, key: t.key }));
    },
  });
}

const QUOTA_KEYS = {
  quotas: (id: string) => ["tenants", "quotas", id] as const,
  features: (id: string) => ["tenants", "quota-features", id] as const,
};

/** Quota tháng hiện tại + mức đã dùng (platform_admin xem mọi tenant). */
export function useTenantQuotas(id: string, enabled: boolean) {
  return useQuery({
    queryKey: QUOTA_KEYS.quotas(id),
    enabled,
    queryFn: () => api<QuotaSetResponse>(`/admin/tenants/${id}/quotas`),
  });
}

/** PUT thay cả bộ; thành công → ghi `version` mới vào bản tenant đang cache (Info và Quota dùng chung version, E22) và làm mới banner/usage. */
export function useSetTenantQuotas(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: QuotaSetRequest) =>
      api<QuotaSetResponse>(`/admin/tenants/${id}/quotas`, { method: "PUT", body }),
    onSuccess: (res) => {
      qc.setQueryData(QUOTA_KEYS.quotas(id), res);
      qc.setQueryData<TenantDetail>(KEYS.detail(id), (old) =>
        old ? { ...old, version: res.version } : old,
      );
      void qc.invalidateQueries({ queryKey: ["quota-banner"] });
      void qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

/** Feature tenant dùng được (core + đã entitlement chưa thu hồi) để thêm quota; `limit=1` vì chỉ cần `features`. */
export function useQuotaFeatureOptions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: QUOTA_KEYS.features(id),
    enabled,
    queryFn: async (): Promise<QuotaFeatureOption[]> => {
      const m = await api<GrantMatrix>("/admin/grants/matrix", {
        query: { tenant_id: id, limit: 1 },
      });
      return m.features
        .filter((f) => f.state === "core" || f.state === "entitled")
        .map((f) => ({ id: f.feature.id, key: f.feature.key, name: f.feature.name }));
    },
  });
}
