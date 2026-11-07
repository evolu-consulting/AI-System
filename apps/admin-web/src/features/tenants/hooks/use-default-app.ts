// tenant-default-app · hook đọc/ghi app mặc định của công ty (tách khỏi component, không đổi hành vi).
import type {
  AppCatalogListResponse,
  DefaultAppRequest,
  TenantDefaultAppResponse,
} from "@ai/contracts/app-catalog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

const keyOf = (id: string) => ["tenants", "default-app", id] as const;
const pathOf = (id: string) => `/admin/tenants/${encodeURIComponent(id)}/default-app`;

export function useDefaultApp(tenantId: string) {
  return useQuery({
    queryKey: keyOf(tenantId),
    queryFn: () => api<TenantDefaultAppResponse>(pathOf(tenantId)),
  });
}

export function useAppCatalog() {
  return useQuery({
    queryKey: ["apps"],
    queryFn: () => api<AppCatalogListResponse>("/admin/apps"),
  });
}

export function useSaveDefaultApp(
  tenantId: string,
  opts: { onSaved: () => void; onError: (err: unknown) => void },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DefaultAppRequest) =>
      api<TenantDefaultAppResponse>(pathOf(tenantId), { method: "PUT", body }),
    onSuccess: (r) => {
      qc.setQueryData(keyOf(tenantId), r);
      opts.onSaved();
    },
    onError: opts.onError,
  });
}
