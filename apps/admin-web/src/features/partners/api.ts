// ADM-FR-74, ADM-FR-75 · gọi API /admin/external-orgs* (nơi duy nhất của feature partners) dưới dạng hook TanStack Query.
import type {
  ExternalOrg,
  ExternalOrgListResponse,
  ExternalUserCreateRequest,
  TempPasswordResponse,
  User,
  UserCreateResponse,
  UserListResponse,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const PARTNERS_PAGE_SIZE = 50;

export type OrgListParams = { tenantId?: string; q: string; offset: number };

export const PARTNER_KEYS = {
  all: ["partners"] as const,
  list: (p: OrgListParams) => ["partners", "list", p] as const,
  detail: (id: string) => ["partners", "detail", id] as const,
  users: (id: string, q: string, offset: number) => ["partners", "users", id, q, offset] as const,
};

export function useOrgList(params: OrgListParams, enabled: boolean) {
  return useQuery({
    queryKey: PARTNER_KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<ExternalOrgListResponse>("/admin/external-orgs", {
        query: {
          tenant_id: params.tenantId,
          q: params.q || undefined,
          limit: PARTNERS_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

export function useOrg(id: string | undefined) {
  return useQuery({
    queryKey: PARTNER_KEYS.detail(id ?? ""),
    enabled: !!id,
    queryFn: () => api<ExternalOrg>(`/admin/external-orgs/${id}`),
  });
}

export function useCreateOrg(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api<ExternalOrg>("/admin/external-orgs", {
        method: "POST",
        body,
        query: { tenant_id: tenantId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_KEYS.all }),
  });
}

export function useRenameOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<ExternalOrg>(`/admin/external-orgs/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_KEYS.all }),
  });
}

/** Làm mới danh sách công ty (đếm tài khoản), tài khoản của công ty và trang Users. */
function useRefreshPartners() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: PARTNER_KEYS.all }),
      qc.invalidateQueries({ queryKey: ["users"] }),
    ]);
}

/** Vô hiệu công ty (kéo theo mọi tài khoản của công ty). */
export function useDeactivateOrg() {
  const refresh = useRefreshPartners();
  return useMutation({
    mutationFn: (id: string) =>
      api<ExternalOrg>(`/admin/external-orgs/${id}/deactivate`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export function useOrgUsers(orgId: string, q: string, offset: number) {
  return useQuery({
    queryKey: PARTNER_KEYS.users(orgId, q, offset),
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<UserListResponse>(`/admin/external-orgs/${orgId}/users`, {
        query: { q: q || undefined, limit: PARTNERS_PAGE_SIZE, offset: offset || undefined },
      }),
  });
}

/** `gcTime: 0`: mật khẩu tạm không nằm lại trong cache mutation. */
export function useCreateOrgUser(orgId: string) {
  const refresh = useRefreshPartners();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: ExternalUserCreateRequest) =>
      api<UserCreateResponse>(`/admin/external-orgs/${orgId}/users`, { method: "POST", body }),
    onSuccess: refresh,
  });
}

export function useDeactivateOrgUser(orgId: string) {
  const refresh = useRefreshPartners();
  return useMutation({
    mutationFn: (userId: string) =>
      api<User>(`/admin/external-orgs/${orgId}/users/${userId}/deactivate`, { method: "POST" }),
    onSuccess: refresh,
  });
}

export type PartnerUserApiAction = "lock" | "unlock" | "reset-password";

/** Khoá / mở khoá / reset dùng lại `/admin/users/:id/*`. `gcTime: 0` cho mật khẩu tạm của reset. */
export function usePartnerUserAction() {
  const refresh = useRefreshPartners();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ id, action }: { id: string; action: PartnerUserApiAction }) =>
      api<User | TempPasswordResponse>(`/admin/users/${id}/${action}`, { method: "POST" }),
    onSuccess: refresh,
  });
}
