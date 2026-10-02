// ADM-FR-04 · ADM-FR-62 · dữ liệu của trang Users: tenant đang xem (platform chọn qua URL, tenant_admin cố định), bộ lọc Group, danh sách.
import type { Me } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useTenantOptions } from "@/features/tenants/api";
import { ApiError } from "@/lib/http";
import { resolveViewedTenant } from "@/lib/viewed-tenant";
import { USERS_PAGE_SIZE, useUserList } from "../api";
import type { RoleFilter, StatusFilter } from "../components/list/UserFilters";
import { useUsersGroupFilter } from "./use-users-group-filter";

const route = getRouteApi("/_authed/users");

export function useUsersView(me: Me | null) {
  const search = route.useSearch();
  const options = useTenantOptions(me?.role === "platform_admin");
  const tn = resolveViewedTenant(me, search.tenant, options);
  const group = useUsersGroupFilter(search.group, tn, !!me);
  const page = search.page ?? 1;
  const list = useUserList(
    {
      tenantId: tn.tenantId,
      q: search.q ?? "",
      status: search.status,
      role: search.role,
      login: search.login,
      group: group.id,
      offset: (page - 1) * USERS_PAGE_SIZE,
    },
    tn.ready && !!me && group.ready,
  );
  const canCreate = tn.isPlatform ? !!tn.tenantId : true;
  const drawerMode: "edit" | "create" = search.drawer === "edit" ? "edit" : "create";
  const err = list.error instanceof ApiError ? list.error : null;

  return {
    ...tn,
    search,
    page,
    list,
    group,
    canCreate,
    drawerMode,
    drawerOpen: !!search.drawer && (drawerMode === "edit" || canCreate),
    filtered: !!(search.q || search.status || search.role || search.login || group.id),
    loadError: err ? { message: err.message, code: err.code } : null,
    filterState: {
      status: (search.status ?? "all") as StatusFilter,
      role: (search.role ?? "all") as RoleFilter,
      never: search.login === "never",
      q: search.q ?? "",
    },
  };
}
