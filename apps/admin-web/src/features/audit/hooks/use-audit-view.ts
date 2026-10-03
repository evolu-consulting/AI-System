// ADM-FR-51 · M4-R12 · Q8 · trạng thái màn Nhật ký: bộ lọc lấy từ URL; platform lọc được theo tenant, tenant_admin do server giới hạn.
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import type { Period } from "@/components/shared/form/period";
import { periodRange } from "@/components/shared/form/period";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { useAuditList } from "../api";
import { type AuditSearch, hasFilters, periodFromSearch, rangeForUrl } from "../lib/search";

export function useAuditView(search: AuditSearch) {
  const navigate = useNavigate();
  const platform = useSession((s) => s.me?.role) === "platform_admin";
  const options = useTenantOptions(platform);
  const today = useMemo(() => new Date(), []);
  const period = periodFromSearch(search, today);
  const range = periodRange(period, today);
  const tenantKey = platform ? search.tenant : undefined;
  const system = tenantKey === "system";
  const tenantId = system ? "system" : options.data?.find((t) => t.key === tenantKey)?.id;
  // Mã tenant lạ: đợi danh sách; không thấy → danh sách rỗng (bỏ lọc tenant sẽ hiện tất cả, sai nghĩa).
  const waiting = !!tenantKey && !system && options.isPending;
  const query = useAuditList(
    {
      tenantId,
      entity: search.entity,
      action: search.action,
      actorId: search.actor,
      from: range.from,
      to: range.to,
      q: search.q,
    },
    !waiting && !(tenantKey && !tenantId && options.isSuccess),
  );
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const go = (next: AuditSearch) => void navigate({ to: "/audit", search: next, replace: true });
  return {
    platform,
    tenants: options.data ?? [],
    search,
    period,
    query,
    items,
    filtered: hasFilters(search),
    set: (patch: Partial<AuditSearch>) => go({ ...search, ...patch }),
    setPeriod: (p: Period) => go({ ...search, ...rangeForUrl(p, today) }),
    clear: () => go({}),
  };
}
