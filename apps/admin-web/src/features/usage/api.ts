// ADM-FR-42 · M4-R08 · gọi GET /admin/usage và /admin/usage.csv (nơi duy nhất của feature usage).
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { downloadFile } from "@/lib/download";
import { api } from "@/lib/http";
import type { UsageParams, UsageReport } from "./lib/types";

const query = (p: UsageParams) => ({ tenant_id: p.tenantId, from: p.from, to: p.to });

/** Báo cáo theo khoảng ngày; `invalidateQueries(["usage"])` sau khi đổi quota. */
export function useUsage(params: UsageParams, enabled: boolean) {
  return useQuery({
    queryKey: ["usage", params] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api<UsageReport>("/admin/usage", { query: query(params) }),
  });
}

/** Tải CSV theo cùng bộ lọc (Bearer → Blob). */
export function useUsageCsv() {
  return useMutation({
    mutationFn: (p: UsageParams) =>
      downloadFile("/admin/usage.csv", {
        query: query(p),
        fallbackName: `usage-${p.from}-${p.to}.csv`,
      }),
  });
}
