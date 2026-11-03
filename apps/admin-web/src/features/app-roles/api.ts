// CR-112 · ADM-FR-80, ADM-FR-82 · gọi `/admin/app-roles*` + danh sách người dùng nội bộ của công ty (nơi duy nhất của feature).
// `tenantId` chỉ platform_admin truyền; tenant_admin để undefined (server suy ra từ phiên, công ty khác ⇒ 404).
import type {
  AppRole,
  AppRoleListResponse,
  AppRoleMembersAddResponse,
  UserListResponse,
} from "@ai/contracts";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";
import type { OpsApi } from "./lib/staging";

export const USERS_PAGE = 50;

export const ROLE_KEYS = {
  all: ["app-roles"] as const,
  list: (tenantId: string | undefined) => ["app-roles", "list", tenantId ?? "self"] as const,
  users: (tenantId: string | undefined, q: string, offset: number) =>
    ["app-roles", "users", tenantId ?? "self", q, offset] as const,
};

export function useAppRoles(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ROLE_KEYS.list(tenantId),
    enabled,
    staleTime: 0,
    queryFn: () => api<AppRoleListResponse>("/admin/app-roles", { query: { tenant_id: tenantId } }),
  });
}

/** Người dùng NỘI BỘ của công ty (đối tác không vào vai, ADM-BR-16), tìm theo tên/username. */
export function useRoleUsers(
  p: { tenantId: string | undefined; q: string; offset: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ROLE_KEYS.users(p.tenantId, p.q, p.offset),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    queryFn: () =>
      api<UserListResponse>("/admin/users", {
        query: {
          tenant_id: p.tenantId,
          q: p.q || undefined,
          kind: "internal",
          limit: USERS_PAGE,
          offset: p.offset || undefined,
        },
      }),
  });
}

/** Lời gọi ghi của một lô lưu (tuần tự, `runOps`). */
export function roleOps(tenantId: string | undefined): OpsApi {
  return {
    create: (body) =>
      api<AppRole>("/admin/app-roles", { method: "POST", body, query: { tenant_id: tenantId } }),
    update: (id, body) => api<AppRole>(`/admin/app-roles/${id}`, { method: "PATCH", body }),
    addMembers: (id, userIds) =>
      api<AppRoleMembersAddResponse>(`/admin/app-roles/${id}/members`, {
        method: "POST",
        body: { user_ids: userIds },
      }),
    removeMember: (id, userId) =>
      api<undefined>(`/admin/app-roles/${id}/members/${userId}`, { method: "DELETE" }),
    remove: (id) => api<undefined>(`/admin/app-roles/${id}`, { method: "DELETE" }),
  };
}

/** Sau khi lưu: vai, nhóm (thành viên/grant của Group vai đổi), gói (số vai/người) đều cũ. */
export function useInvalidateRoles() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ROLE_KEYS.all }),
      qc.invalidateQueries({ queryKey: ["groups"] }),
      qc.invalidateQueries({ queryKey: ["tenants", "packs"] }),
      qc.invalidateQueries({ queryKey: ["users"] }),
      qc.invalidateQueries({ queryKey: ["access"] }),
    ]);
}
