// ADM-FR-42 · M4-R08 · trạng thái màn Chi phí & quota: tenant + kỳ lấy từ URL (`?tenant=<mã>&period=YYYY-MM`), tenant_admin bị ép tenant mình.
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { useUsage } from "../api";
import { currentMonth, isMonth, monthRange, previousMonth, recentMonths } from "../lib/months";

export type UsageSearch = { tenant?: string; period?: string };

export function useUsageView(search: UsageSearch) {
  const navigate = useNavigate();
  const me = useSession((s) => s.me);
  const platform = me?.role === "platform_admin";
  const options = useTenantOptions(platform);
  const months = useMemo(() => recentMonths(new Date()), []);
  const month =
    search.period && months.includes(search.period) ? search.period : currentMonth(new Date());
  const range = monthRange(month);
  const tenantKey = platform ? (search.tenant ?? null) : null;
  const tenantId = options.data?.find((t) => t.key === tenantKey)?.id;
  // Mã tenant lạ → chưa biết id: đợi danh sách; có danh sách mà không thấy → 404.
  const unknownTenant = platform && tenantKey !== null && options.isSuccess && !tenantId;
  // tenant_admin: `?tenant=` khác tenant mình → 404 (BR-09).
  const foreign = !platform && !!search.tenant && search.tenant !== me?.tenant.key;
  const waiting = platform && tenantKey !== null && options.isPending;
  const params = { tenantId, from: range.from, to: range.to };
  const query = useUsage(params, !!me && !foreign && !unknownTenant && !waiting);

  const go = (next: UsageSearch) =>
    void navigate({
      to: "/usage",
      search: { tenant: next.tenant, period: next.period },
      replace: true,
    });
  return {
    platform,
    months,
    month,
    prevMonth: previousMonth(month),
    tenantKey,
    tenants: options.data ?? [],
    params,
    query,
    notFound: foreign || unknownTenant,
    setTenant: (key: string | null) =>
      go({ tenant: key ?? undefined, period: isMonth(search.period) ? search.period : undefined }),
    setPeriod: (period: string) => go({ tenant: search.tenant, period }),
  };
}
