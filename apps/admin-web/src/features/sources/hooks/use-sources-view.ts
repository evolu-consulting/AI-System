// ADM-FR-68 · dữ liệu trang Nguồn: công ty đang xem (platform chọn qua `?tenant=<mã>`, tenant_admin cố định), danh sách cursor,
// lọc ký hiệu phía client (API không có `q`; trang 100 dòng). platform_admin chưa chọn công ty ⇒ không gọi API (server: 404).
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { resolveViewedTenant } from "@/lib/viewed-tenant";
import { useSourceList } from "../api";
import { filterByKey } from "../lib/source-view";
import { useSourcesNav } from "./use-sources-nav";

const route = getRouteApi("/_authed/sources");

export function useSourcesView() {
  const me = useSession((s) => s.me);
  const search = route.useSearch();
  const nav = useSourcesNav();
  const options = useTenantOptions(me?.role === "platform_admin");
  const tn = resolveViewedTenant(me, search.tenant, options);
  const needsTenant = tn.isPlatform && !tn.tenantId;
  const enabled = !!me && tn.ready && !needsTenant;
  const list = useSourceList({ tenantId: tn.tenantId, kind: search.kind }, enabled);
  const all = useMemo(() => list.data?.pages.flatMap((p) => p.items), [list.data]);
  const rows = useMemo(() => (all ? filterByKey(all, search.q ?? "") : undefined), [all, search.q]);
  return { me, search, nav, ...tn, needsTenant, list, rows, loadedAll: all };
}
export type SourcesView = ReturnType<typeof useSourcesView>;
