// ADM-FR-41, ADM-FR-42 · gọi GET /admin/overview (tenant_admin) và CR-121 C-3b · GET /ops/overview của Hub (platform_admin).
import type { OpsOverview } from "@ai/contracts/hub-admin";
import type { OverviewResponse } from "@ai/contracts/overview";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

export const OVERVIEW_KEY = ["overview"] as const;
export const OPS_OVERVIEW_KEY = ["overview", "ops"] as const;

/** Bản tenant_admin. `enabled=false` cho platform_admin (đã có `useOpsOverview`). */
export function useOverview(enabled = true) {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    enabled,
    refetchOnWindowFocus: true,
    queryFn: () => api<OverviewResponse>("/admin/overview"),
  });
}

/** Chỉ platform_admin; Hub cache 60 s nên làm mới theo nhịp đó. Chưa cấu hình Hub ⇒ không gọi (trang hiện lý do). */
export function useOpsOverview(enabled: boolean) {
  return useQuery({
    queryKey: OPS_OVERVIEW_KEY,
    enabled: enabled && hubConfigured(),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: () => {
      const u = hubUrl("/ops/overview");
      if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình");
      return api<OpsOverview>(u);
    },
  });
}
