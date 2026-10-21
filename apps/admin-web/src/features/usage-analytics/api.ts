// ADM-FR-42 · usage-analytics · gọi `/admin/usage/analytics`, `/admin/usage/records(.csv)`, `/admin/usage/runs/:id` (nơi duy
// nhất của feature). Bản tenant_admin không có `cost_usd` (server xoá).
import type { UsageAnalytics, UsageGrain, UsageRecords, UsageRun } from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { downloadFile } from "@/lib/download";
import { api } from "@/lib/http";

export type AnalyticsParams = {
  tenantId?: string;
  from: string;
  to: string;
  grain: UsageGrain;
  app?: string;
  agentId?: string;
  model?: string;
  userId?: string;
  outcome?: string;
};

const filterQuery = (p: AnalyticsParams) => ({
  tenant_id: p.tenantId,
  from: p.from,
  to: p.to,
  app: p.app,
  agent_id: p.agentId,
  model: p.model,
  user_id: p.userId,
  outcome: p.outcome,
});

export function useAnalytics(p: AnalyticsParams, enabled: boolean) {
  return useQuery({
    queryKey: ["usage-analytics", p] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<UsageAnalytics>("/admin/usage/analytics", {
        query: { ...filterQuery(p), grain: p.grain },
      }),
  });
}

export const RECORDS_PAGE = 50;

export function useRecords(p: AnalyticsParams, cursor: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["usage-records", p, cursor ?? null] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<UsageRecords>("/admin/usage/records", {
        query: { ...filterQuery(p), cursor, limit: RECORDS_PAGE },
      }),
  });
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["usage-run", runId] as const,
    enabled: runId !== null,
    queryFn: () => api<UsageRun>(`/admin/usage/runs/${encodeURIComponent(runId ?? "")}`),
  });
}

export function useRecordsCsv() {
  return useMutation({
    mutationFn: (p: AnalyticsParams) =>
      downloadFile("/admin/usage/records.csv", {
        query: filterQuery(p),
        fallbackName: `usage-records-${p.from}-${p.to}.csv`,
      }),
  });
}
