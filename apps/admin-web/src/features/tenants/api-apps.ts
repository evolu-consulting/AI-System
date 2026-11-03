// CR-112 · ADM-FR-78 · dữ liệu phụ của tab "Ứng dụng & Gói": vai theo app của công ty (đếm vai "không hiệu lực").
import type { AppRoleListResponse } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

/** `GET /admin/app-roles?tenant_id=` — mọi vai của công ty (≤ 500); tính "không hiệu lực" phía client theo mức đang chọn. */
export function useTenantAppRoles(tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["tenants", "app-roles", tenantId] as const,
    enabled,
    queryFn: () => api<AppRoleListResponse>("/admin/app-roles", { query: { tenant_id: tenantId } }),
  });
}
