// ADM-FR-50 · gọi API /admin/secrets* (nơi duy nhất) dưới dạng hook TanStack Query.
// D10: giá trị secret chỉ có ở body request; mutation `gcTime: 0` và response không chứa giá trị.
import type {
  Secret,
  SecretCreateRequest,
  SecretListResponse,
  SecretNoteRequest,
  SecretReplaceRequest,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const SECRETS_PAGE_SIZE = 50;

export type SecretListParams = { q: string; used?: boolean; offset: number };

const KEYS = {
  all: ["secrets"] as const,
  list: (p: SecretListParams) => ["secrets", "list", p] as const,
  byName: (name: string) => ["secrets", "by-name", name] as const,
};

const path = (name: string) => `/admin/secrets/${encodeURIComponent(name)}`;

export function useSecretList(params: SecretListParams, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<SecretListResponse>("/admin/secrets", {
        query: {
          q: params.q || undefined,
          used: params.used === undefined ? undefined : String(params.used),
          limit: SECRETS_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

/** Một secret theo tên (không có GET :name nên tìm `q=<tên>` rồi khớp chính xác); `null` = không có. */
export function useSecretByName(name: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.byName(name ?? ""),
    enabled: enabled && !!name,
    queryFn: async (): Promise<Secret | null> => {
      const res = await api<SecretListResponse>("/admin/secrets", {
        query: { q: name, limit: 20 },
      });
      return res.items.find((s) => s.name === name) ?? null;
    },
  });
}

export function useCreateSecret() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: SecretCreateRequest) =>
      api<Secret>("/admin/secrets", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useReplaceSecret(name: string) {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: SecretReplaceRequest) => api<Secret>(path(name), { method: "PUT", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useUpdateSecretNote(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SecretNoteRequest) => api<Secret>(path(name), { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useDeleteSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<undefined>(path(name), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}
