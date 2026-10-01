// ADM-FR-04 · dữ liệu của trang Users: xác định tenant đang xem (platform chọn qua URL, tenant_admin cố định) và nạp danh sách.
import type { Me } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { ApiError } from "@/lib/http";
import { USERS_PAGE_SIZE, useTenantOptions, useUserList } from "../api";
import type { RoleFilter, StatusFilter } from "../components/UserFilters";

const route = getRouteApi("/_authed/users");

/** Tenant đang xem: tenant_admin cố định; platform chọn qua `?tenant=<mã>` (mã lạ → `unknown` → 404). */
function useViewedTenant(me: Me | null, tenantParam: string | undefined) {
  const isPlatform = me?.role === "platform_admin";
  const options = useTenantOptions(isPlatform);
  const tenantKey = isPlatform ? (tenantParam ?? null) : (me?.tenant.key ?? null);
  const picked =
    isPlatform && tenantKey ? options.data?.find((o) => o.key === tenantKey) : undefined;
  const unknown = isPlatform && !!tenantKey && !!options.data && !picked;
  return {
    isPlatform,
    tenants: options.data,
    tenantKey,
    // Chỉ platform_admin gửi `tenant_id`; tenant_admin do server suy ra từ phiên.
    tenantId: isPlatform ? picked?.id : undefined,
    unknown,
    ready: isPlatform ? !!options.data && !unknown : true,
  };
}

export function useUsersView(me: Me | null) {
  const search = route.useSearch();
  const tn = useViewedTenant(me, search.tenant);
  const page = search.page ?? 1;
  const list = useUserList(
    {
      tenantId: tn.tenantId,
      q: search.q ?? "",
      status: search.status,
      role: search.role,
      login: search.login,
      offset: (page - 1) * USERS_PAGE_SIZE,
    },
    tn.ready && !!me,
  );
  const canCreate = tn.isPlatform ? !!tn.tenantId : true;
  const drawerMode: "edit" | "create" = search.drawer === "edit" ? "edit" : "create";
  const err = list.error instanceof ApiError ? list.error : null;

  return {
    ...tn,
    search,
    page,
    list,
    canCreate,
    drawerMode,
    drawerOpen: !!search.drawer && (drawerMode === "edit" || canCreate),
    filtered: !!search.q || !!search.status || !!search.role || !!search.login,
    loadError: err ? { message: err.message, code: err.code } : null,
    filterState: {
      status: (search.status ?? "all") as StatusFilter,
      role: (search.role ?? "all") as RoleFilter,
      never: search.login === "never",
      q: search.q ?? "",
    },
  };
}
