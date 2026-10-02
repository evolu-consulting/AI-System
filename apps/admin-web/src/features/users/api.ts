// ADM-FR-04, ADM-FR-05, ADM-FR-63 · gọi API /admin/users* (nơi duy nhất) dưới dạng hook TanStack Query.
import type {
  TempPasswordResponse,
  User,
  UserCreateRequest,
  UserCreateResponse,
  UserListResponse,
  UserUpdateRequest,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const USERS_PAGE_SIZE = 50;

export type UserListParams = {
  tenantId?: string;
  q: string;
  status?: "active" | "locked";
  role?: "platform_admin" | "tenant_admin" | "member";
  login?: "never";
  /** Id group (từ `?group=<key>` đã ánh xạ). */
  group?: string;
  offset: number;
};

const KEYS = {
  all: ["users"] as const,
  list: (p: UserListParams) => ["users", "list", p] as const,
  detail: (id: string) => ["users", "detail", id] as const,
};

export function useUserList(params: UserListParams, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<UserListResponse>("/admin/users", {
        query: {
          tenant_id: params.tenantId,
          q: params.q || undefined,
          status: params.status,
          role: params.role,
          login: params.login,
          group: params.group,
          limit: USERS_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

export function useUser(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.detail(id ?? ""),
    enabled: enabled && !!id,
    queryFn: () => api<User>(`/admin/users/${id}`),
  });
}

export function useCreateUser(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: UserCreateRequest) =>
      api<UserCreateResponse>("/admin/users", {
        method: "POST",
        body,
        query: { tenant_id: tenantId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useUpdateUser(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UserUpdateRequest) =>
      api<User>(`/admin/users/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export type UserAction = "lock" | "unlock" | "logout-all" | "reset-password";

/** Hành động trên một user. `gcTime: 0` để mật khẩu tạm của `reset-password` không nằm lại trong cache mutation. */
export function useUserAction() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ id, action }: { id: string; action: UserAction }) =>
      api<User | TempPasswordResponse | undefined>(`/admin/users/${id}/${action}`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}
