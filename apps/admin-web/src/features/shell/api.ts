// ADM-FR-41 · M4-R06 · gọi GET /admin/quota-banner (banner dưới topbar của tenant_admin).
import type { QuotaBannerResponse } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

/** Nơi khác (lưu quota) gọi `invalidateQueries({ queryKey: QUOTA_BANNER_KEY })`. */
export const QUOTA_BANNER_KEY = ["quota-banner"] as const;

export function useQuotaBannerQuery(enabled: boolean) {
  return useQuery({
    queryKey: QUOTA_BANNER_KEY,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: () => api<QuotaBannerResponse>("/admin/quota-banner"),
  });
}
