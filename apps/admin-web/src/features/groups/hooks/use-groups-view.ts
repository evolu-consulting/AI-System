// ADM-FR-62 · dữ liệu của trang Groups: tenant đang xem (platform chọn qua URL) + danh sách (D9: chưa chọn tenant → không gọi API).
import type { Me } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useTenantOptions } from "@/features/tenants/api";
import { ApiError } from "@/lib/http";
import { resolveViewedTenant } from "@/lib/viewed-tenant";
import { GROUPS_PAGE_SIZE, useGroupList } from "../api";

const route = getRouteApi("/_authed/groups/");

export function useGroupsView(me: Me | null) {
  const search = route.useSearch();
  const options = useTenantOptions(me?.role === "platform_admin");
  const tn = resolveViewedTenant(me, search.tenant, options);
  const page = search.page ?? 1;
  const needsTenant = tn.isPlatform && !tn.tenantId;
  const list = useGroupList(
    { tenantId: tn.tenantId, q: search.q ?? "", offset: (page - 1) * GROUPS_PAGE_SIZE },
    tn.ready && !!me && !needsTenant,
  );
  const err = list.error instanceof ApiError ? list.error : null;
  return {
    ...tn,
    search,
    page,
    list,
    needsTenant,
    canCreate: !needsTenant,
    filtered: !!search.q,
    loadError: err ? { message: err.message, code: err.code } : null,
  };
}
