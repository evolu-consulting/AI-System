// ADM-FR-74 · dữ liệu của trang Đối tác: tenant đang xem (platform chọn qua URL, tenant_admin cố định) + danh sách công ty.
import type { Me } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useWorkspaceView } from "@/features/tenants/lib/use-workspace-view";
import { ApiError } from "@/lib/http";
import { PARTNERS_PAGE_SIZE, useOrgList } from "../api";

const route = getRouteApi("/_authed/tenants/$tenantId");

export function usePartnersView(me: Me | null) {
  const search = route.useSearch();
  const tn = useWorkspaceView(me);
  const page = search.page ?? 1;
  const needsTenant = tn.isPlatform && !tn.tenantId;
  const list = useOrgList(
    { tenantId: tn.tenantId, q: search.q ?? "", offset: (page - 1) * PARTNERS_PAGE_SIZE },
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
