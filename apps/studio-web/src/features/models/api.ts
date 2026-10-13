// HUB-FR-66 · API Models của Studio (`/studio/api/providers*`). Đường dẫn tương đối; secret chỉ đi bằng `secret_id`.
import type {
  ProviderCreate,
  ProviderDetail,
  ProviderItemSchema,
  ProviderUpdate,
} from "@ai/contracts/studio";
import { queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "#/lib/http";

export type ProviderItem = z.infer<typeof ProviderItemSchema>;
export type ProviderList = {
  items: ProviderItem[];
  total: number;
  truncated: boolean;
  hub_config_version: number;
};

export const PROVIDERS_KEY = ["studio", "providers"] as const;

/** Trạng thái do Worker ghi nên làm tươi 10 s (tab ẩn thì react-query tạm dừng). */
export const providersQuery = queryOptions({
  queryKey: PROVIDERS_KEY,
  queryFn: ({ signal }) => api<ProviderList>("/studio/api/providers", { signal }),
  refetchInterval: 10_000,
  staleTime: 0,
});

export const providerDetailQuery = (id: string) =>
  queryOptions({
    queryKey: [...PROVIDERS_KEY, id] as const,
    queryFn: ({ signal }) =>
      api<ProviderDetail>(`/studio/api/providers/${encodeURIComponent(id)}`, { signal }),
    staleTime: 0,
  });

export const createProvider = (body: ProviderCreate) =>
  api<ProviderDetail>("/studio/api/providers", { method: "POST", body });

export const updateProvider = (v: { id: string; body: ProviderUpdate }) =>
  api<ProviderDetail>(`/studio/api/providers/${encodeURIComponent(v.id)}`, {
    method: "PUT",
    body: v.body,
  });

export const deleteProvider = (v: { id: string; version: number }) =>
  api<undefined>(`/studio/api/providers/${encodeURIComponent(v.id)}`, {
    method: "DELETE",
    query: { version: v.version },
  });
