// app-catalog · gọi `/admin/apps*` (platform_admin) dưới dạng hook TanStack Query. Danh sách người dùng thấy: `/auth/me/apps`.
import type {
  AppCatalogItem,
  AppCatalogListResponse,
  AppCreateRequest,
  AppUpdateRequest,
  EntitlementListResponse,
} from "@ai/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

const KEY = ["apps"] as const;
const path = (key: string) => `/admin/apps/${encodeURIComponent(key)}`;

export const useAppList = (enabled: boolean) =>
  useQuery({ queryKey: KEY, enabled, queryFn: () => api<AppCatalogListResponse>("/admin/apps") });

export function useCreateApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AppCreateRequest) =>
      api<AppCatalogItem>("/admin/apps", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; body: AppUpdateRequest }) =>
      api<AppCatalogItem>(path(v.key), { method: "PATCH", body: v.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api<undefined>(path(key), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** CR-118 · công ty được cấp từng feature của app (≤ 200 mỗi feature) — nguồn của bảng "Công ty" và số liệu Tổng quan. */
export function useFeatureEntitlementLists(featureIds: readonly string[]) {
  return useQueries({
    queries: featureIds.map((id) => ({
      queryKey: ["features", "entitlements", id, 0, 200] as const,
      queryFn: () =>
        api<EntitlementListResponse>(`/admin/features/${id}/entitlements`, {
          query: { limit: 200 },
        }),
    })),
  });
}
