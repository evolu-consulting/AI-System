// HUB-FR-102 · `GET /directory` (danh bạ cùng tenant). Gọi API chỉ ở file này (plan-frontend §1).
import {
  DIRECTORY_LIMIT_MAX,
  type DirectoryResponse,
  DirectoryResponseSchema,
} from "@ai/contracts/chat";
import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/http";

export const DIRECTORY_KEY = "directory";
export const DIRECTORY_STALE_MS = 30_000;

export async function fetchDirectory(q: string, signal?: AbortSignal): Promise<DirectoryResponse> {
  const term = q.trim();
  return DirectoryResponseSchema.parse(
    await api<unknown>("/directory", {
      query: { q: term || undefined, limit: DIRECTORY_LIMIT_MAX },
      signal,
    }),
  );
}

/** `q` đã debounce ở nơi gọi (250 ms như sidebar). */
export function useDirectory(q: string, enabled = true) {
  const term = q.trim();
  return useQuery({
    queryKey: [DIRECTORY_KEY, term],
    queryFn: ({ signal }) => fetchDirectory(term, signal),
    enabled,
    staleTime: DIRECTORY_STALE_MS,
    retry: false,
  });
}
