// app-catalog · gọi `/admin/apps*` (platform_admin) dưới dạng hook TanStack Query. Danh sách người dùng thấy: `/auth/me/apps`.
import type {
  AppCatalogItem,
  AppCatalogListResponse,
  AppCreateRequest,
  AppUpdateRequest,
} from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
