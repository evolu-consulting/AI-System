// ADM-FR-62 · gọi API /admin/groups* (nơi duy nhất của feature groups) dưới dạng hook TanStack Query.
import type {
  Group,
  GroupCreateRequest,
  GroupListItem,
  GroupListResponse,
  GroupMemberListResponse,
  GroupMembersAddRequest,
  GroupMembersAddResponse,
  GroupUpdateRequest,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

import { GROUPS_PAGE_SIZE, MEMBERS_PAGE_SIZE } from "./lib/paging";

export type GroupListParams = { tenantId?: string; q: string; offset: number };

export const GROUP_KEYS = {
  all: ["groups"] as const,
  list: (p: GroupListParams) => ["groups", "list", p] as const,
  detail: (id: string) => ["groups", "detail", id] as const,
  options: (tenantId: string) => ["groups", "options", tenantId] as const,
  members: (id: string, q: string, offset: number) => ["groups", "members", id, q, offset] as const,
};

export function useGroupList(params: GroupListParams, enabled: boolean) {
  return useQuery({
    queryKey: GROUP_KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<GroupListResponse>("/admin/groups", {
        query: {
          tenant_id: params.tenantId,
          q: params.q || undefined,
          limit: GROUPS_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (g: Pick<GroupListItem | Group, "id">) =>
      api<undefined>(`/admin/groups/${g.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}

/** Danh sách group của tenant cho ô chọn/lọc (≤ 200, `staleTime` 30 s): `{id, key, name}`. */
export function useGroupOptions(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: GROUP_KEYS.options(tenantId ?? ""),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api<GroupListResponse>("/admin/groups", {
        query: { tenant_id: tenantId, limit: 200 },
      });
      return res.items.map((g) => ({ id: g.id, key: g.key, name: g.name, is_beta: g.is_beta }));
    },
  });
}

export function useGroup(id: string | undefined) {
  return useQuery({
    queryKey: GROUP_KEYS.detail(id ?? ""),
    enabled: !!id,
    queryFn: () => api<Group>(`/admin/groups/${id}`),
  });
}

export function useCreateGroup(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupCreateRequest) =>
      api<Group>("/admin/groups", { method: "POST", body, query: { tenant_id: tenantId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}

export function useUpdateGroup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GroupUpdateRequest) =>
      api<Group>(`/admin/groups/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}

export function useGroupMembers(groupId: string, q: string, offset: number) {
  return useQuery({
    queryKey: GROUP_KEYS.members(groupId, q, offset),
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<GroupMemberListResponse>(`/admin/groups/${groupId}/members`, {
        query: { q: q || undefined, limit: MEMBERS_PAGE_SIZE, offset: offset || undefined },
      }),
  });
}

/** Thêm thành viên (tập hợp, idempotent; thêm một phần). `dry_run` chỉ xem trước: không ghi nên không làm mới cache. */
export function useAddMembers(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Pick<GroupMembersAddRequest, "usernames"> & { dry_run?: boolean }) =>
      api<GroupMembersAddResponse>(`/admin/groups/${groupId}/members`, { method: "POST", body }),
    onSuccess: (_res, vars) =>
      vars.dry_run ? undefined : qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}

export function useRemoveMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<undefined>(`/admin/groups/${groupId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.all }),
  });
}
