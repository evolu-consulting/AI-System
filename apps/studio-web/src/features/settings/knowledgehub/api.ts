// HUB-FR-131 · API kết nối KnowledgeHub của Studio (`/studio/api/kh/connections*`). Response không có giá trị khoá.
import type {
  KhCheckResult,
  KhConnection,
  KhConnectionListResponse,
  KhConnectionUpdate,
  KhConnectionWrite,
} from "@ai/contracts/hub-admin";
import { infiniteQueryOptions } from "@tanstack/react-query";
import { api } from "#/lib/http";

export const KH_KEY = ["studio", "kh", "connections"] as const;
const BASE = "/studio/api/kh/connections";

export const khConnectionsQuery = infiniteQueryOptions({
  queryKey: KH_KEY,
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam, signal }) =>
    api<KhConnectionListResponse>(BASE, { query: { limit: 100, cursor: pageParam }, signal }),
  getNextPageParam: (last) => last.next_cursor ?? undefined,
  staleTime: 0,
});

export const createKhConnection = (body: KhConnectionWrite) =>
  api<KhConnection>(BASE, { method: "POST", body });

export const updateKhConnection = (v: { id: string; body: KhConnectionUpdate }) =>
  api<KhConnection>(`${BASE}/${encodeURIComponent(v.id)}`, { method: "PUT", body: v.body });

export const deleteKhConnection = (v: { id: string; version: number }) =>
  api<undefined>(`${BASE}/${encodeURIComponent(v.id)}`, {
    method: "DELETE",
    query: { version: v.version },
  });

/** KH lỗi vẫn 200 (kết quả nằm trong `items`); `signal` = hạn UI 25 s. */
export const checkKhConnection = (v: { id: string; signal?: AbortSignal }) =>
  api<KhCheckResult>(`${BASE}/${encodeURIComponent(v.id)}/check`, {
    method: "POST",
    signal: v.signal,
  });
