// HUB-FR-68 · HUB-FR-69 · API Secrets của Studio (`/studio/api/secrets*`). Giá trị chỉ đi lên (request), không bao giờ có trong response.
import type {
  HubSecret,
  HubSecretCreateRequest,
  HubSecretKind,
  HubSecretListResponse,
  HubSecretRotateRequest,
} from "@ai/contracts/hub-admin";
import { infiniteQueryOptions } from "@tanstack/react-query";
import { api } from "#/lib/http";

export const SECRETS_KEY = ["studio", "secrets"] as const;

export const secretsQuery = (kind: HubSecretKind) =>
  infiniteQueryOptions({
    queryKey: [...SECRETS_KEY, kind] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api<HubSecretListResponse>("/studio/api/secrets", {
        query: { kind, limit: 100, cursor: pageParam },
        signal,
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 0,
  });

export const createSecret = (body: HubSecretCreateRequest) =>
  api<HubSecret>("/studio/api/secrets", { method: "POST", body });

export const rotateSecret = (v: { id: string; body: HubSecretRotateRequest }) =>
  api<HubSecret>(`/studio/api/secrets/${encodeURIComponent(v.id)}`, {
    method: "PUT",
    body: v.body,
  });

export const deleteSecret = (v: { id: string; version: number }) =>
  api<undefined>(`/studio/api/secrets/${encodeURIComponent(v.id)}`, {
    method: "DELETE",
    query: { version: v.version },
  });
