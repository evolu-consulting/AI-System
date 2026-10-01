// ADM-FR-30, ADM-FR-33, ADM-FR-34 · gọi API /admin/features* (nơi duy nhất) dưới dạng hook TanStack Query.
import type {
  CommandListResponse,
  Entitlement,
  EntitlementListResponse,
  FeatureCreateRequest,
  FeatureDetail,
  FeatureListResponse,
  FeatureUpdateRequest,
  TenantListResponse,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const FEATURES_PAGE_SIZE = 50;

/** Đổi feature/entitlement/tập command đổi "ai dùng được" và feature của command → làm mới cả hai danh sách. */
function invalidateCatalog(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["features"] }),
    qc.invalidateQueries({ queryKey: ["commands"] }),
  ]);
}

export type FeatureStatusFilter = "on" | "beta" | "off";
export type FeatureListParams = { q: string; status?: FeatureStatusFilter; offset: number };

export const FEATURE_KEYS = {
  all: ["features"] as const,
  list: (p: FeatureListParams) => ["features", "list", p] as const,
  detail: (id: string) => ["features", "detail", id] as const,
  commands: (q: string) => ["features", "command-options", q] as const,
  entitlements: (id: string, offset: number, limit: number) =>
    ["features", "entitlements", id, offset, limit] as const,
  tenants: ["features", "tenant-options"] as const,
};

export function useFeatureList(params: FeatureListParams, enabled: boolean) {
  return useQuery({
    queryKey: FEATURE_KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<FeatureListResponse>("/admin/features", {
        query: {
          q: params.q || undefined,
          status: params.status,
          limit: FEATURES_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

export const fetchFeatureDetail = (id: string) => api<FeatureDetail>(`/admin/features/${id}`);

export function useFeature(id: string | undefined) {
  return useQuery({
    queryKey: FEATURE_KEYS.detail(id ?? ""),
    enabled: !!id,
    queryFn: () => fetchFeatureDetail(id as string),
  });
}

/** Command cho ô "Thêm command" (≤ 200, lọc theo `q` ở server khi tổng lớn hơn). */
export function useCommandOptions(q: string) {
  return useQuery({
    queryKey: FEATURE_KEYS.commands(q),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api<CommandListResponse>("/admin/commands", {
        query: { limit: 200, q: q || undefined },
      });
      return res.items.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        enabled: c.enabled,
        featureCount: c.features.length,
      }));
    },
  });
}

export function useCreateFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FeatureCreateRequest) =>
      api<FeatureDetail>("/admin/features", { method: "POST", body }),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useUpdateFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & FeatureUpdateRequest) =>
      api<FeatureDetail>(`/admin/features/${id}`, { method: "PATCH", body }),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useDeleteFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/admin/features/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export const ENTITLEMENTS_PAGE_SIZE = 50;
const ENTITLEMENT_IDS_LIMIT = 200;

/** Entitlement chưa thu hồi của feature (`core` luôn rỗng); chỉ nạp khi mở tab Tenant. */
export function useEntitlements(
  featureId: string | undefined,
  offset: number,
  limit: number = ENTITLEMENTS_PAGE_SIZE,
) {
  return useQuery({
    queryKey: FEATURE_KEYS.entitlements(featureId ?? "", offset, limit),
    enabled: !!featureId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<EntitlementListResponse>(`/admin/features/${featureId}/entitlements`, {
        query: { limit, offset: offset || undefined },
      }),
  });
}

/** Tenant đã được cấp (≤ 200) để loại khỏi danh sách chọn. */
export const useGrantedTenantIds = (featureId: string | undefined) =>
  useEntitlements(featureId, 0, ENTITLEMENT_IDS_LIMIT);

/** Tenant cho ô "+ Cấp cho tenant" (≤ 200); tenant khoá vẫn cấp được. */
export function useTenantOptions(enabled: boolean) {
  return useQuery({
    queryKey: FEATURE_KEYS.tenants,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<TenantListResponse>("/admin/tenants", { query: { limit: 200 } });
      return res.items.map((t) => ({ id: t.id, key: t.key, name: t.name, locked: !t.active }));
    },
  });
}

export function useGrantEntitlement(featureId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) =>
      api<Entitlement>(`/admin/features/${featureId}/entitlements/${tenantId}`, { method: "PUT" }),
    onSuccess: () => invalidateCatalog(qc),
  });
}

export function useRevokeEntitlement(featureId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) =>
      api<undefined>(`/admin/features/${featureId}/entitlements/${tenantId}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateCatalog(qc),
  });
}
