// ADM-FR-30, ADM-FR-33, ADM-FR-34 · gọi API /admin/features* (nơi duy nhất) dưới dạng hook TanStack Query.
import type {
  CommandListResponse,
  FeatureCreateRequest,
  FeatureDetail,
  FeatureListResponse,
  FeatureUpdateRequest,
} from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const FEATURES_PAGE_SIZE = 50;

export type FeatureStatusFilter = "on" | "beta" | "off";
export type FeatureListParams = { q: string; status?: FeatureStatusFilter; offset: number };

export const FEATURE_KEYS = {
  all: ["features"] as const,
  list: (p: FeatureListParams) => ["features", "list", p] as const,
  detail: (id: string) => ["features", "detail", id] as const,
  commands: (q: string) => ["features", "command-options", q] as const,
};

export function useFeatureList(params: FeatureListParams, enabled: boolean) {
  return useQuery({
    queryKey: FEATURE_KEYS.list(params),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<FeatureListResponse>("/admin/features", {
        query: {
          q: params.q || undefined,
          status: params.status,
          limit: FEATURES_PAGE_SIZE,
          offset: params.offset || undefined,
        },
      }),
  });
}

export const fetchFeatureDetail = (id: string) => api<FeatureDetail>(`/admin/features/${id}`);

export function useFeature(id: string | undefined) {
  return useQuery({
    queryKey: FEATURE_KEYS.detail(id ?? ""),
    enabled: !!id,
    queryFn: () => fetchFeatureDetail(id as string),
  });
}

/** Command cho ô "Thêm command" (≤ 200, lọc theo `q` ở server khi tổng lớn hơn). */
export function useCommandOptions(q: string) {
  return useQuery({
    queryKey: FEATURE_KEYS.commands(q),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api<CommandListResponse>("/admin/commands", {
        query: { limit: 200, q: q || undefined },
      });
      return res.items.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        enabled: c.enabled,
        featureCount: c.features.length,
      }));
    },
  });
}

export function useCreateFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FeatureCreateRequest) =>
      api<FeatureDetail>("/admin/features", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEATURE_KEYS.all }),
  });
}

export function useUpdateFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & FeatureUpdateRequest) =>
      api<FeatureDetail>(`/admin/features/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEATURE_KEYS.all }),
  });
}

export function useDeleteFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/admin/features/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEATURE_KEYS.all }),
  });
}
