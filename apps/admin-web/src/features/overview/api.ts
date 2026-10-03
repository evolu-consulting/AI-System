// ADM-FR-41, ADM-FR-42 · gọi GET /admin/overview (nơi duy nhất của feature overview).
import type { OverviewResponse } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const OVERVIEW_KEY = ["overview"] as const;

export function useOverview() {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    refetchOnWindowFocus: true,
    queryFn: () => api<OverviewResponse>("/admin/overview"),
  });
}
