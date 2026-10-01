// ADM-FR-30, ADM-FR-33, ADM-FR-34 · gọi API /admin/features* (nơi duy nhất) dưới dạng hook TanStack Query.
import type { FeatureDetail, FeatureListResponse, FeatureUpdateRequest } from "@ai/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const FEATURES_PAGE_SIZE = 50;

export type FeatureStatusFilter = "on" | "beta" | "off";
export type FeatureListParams = { q: string; status?: FeatureStatusFilter; offset: number };

export const FEATURE_KEYS = {
  all: ["features"] as const,
  list: (p: FeatureListParams) => ["features", "list", p] as const,
  detail: (id: string) => ["features", "detail", id] as const,
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
