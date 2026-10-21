// ADM-FR-42 · M4-R08 · gọi GET /admin/usage và /admin/usage.csv (nơi duy nhất của feature usage).
import type { WorkflowListResponse } from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { downloadFile } from "@/lib/download";
import { api } from "@/lib/http";
import type { UsageParams, UsageReport } from "./lib/types";

const query = (p: UsageParams) => ({
  tenant_id: p.tenantId,
  workflow_id: p.workflowId,
  from: p.from,
  to: p.to,
});

/** Workflow để lọc usage theo lượt gọi Dify (platform_admin). */
export function useWorkflowOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["usage", "workflow-options"] as const,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<WorkflowListResponse>("/admin/workflows", { query: { limit: 200 } });
      return res.items.map((w) => ({ id: w.id, key: w.key, name: w.name }));
    },
  });
}

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
