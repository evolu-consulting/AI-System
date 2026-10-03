// CHAT-AC-28, 29 · trạng thái kết nối của app: run đang nối lại / run `lost` / query lỗi mạng (Hub không với tới).
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import type { ConnectionKind } from "~/components/shared/ConnectionBanner";
import { runStore, useRuns } from "~/features/run/run-store";
import { runDriver } from "~/features/run/runtime";
import { ApiError } from "~/lib/http";

export function useConnection(): { kind: ConnectionKind | null; retry: () => void } {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const netDown = useSyncExternalStore(
    useCallback((cb) => cache.subscribe(cb), [cache]),
    () =>
      cache
        .getAll()
        .some(
          (q) =>
            q.state.status === "error" &&
            q.state.error instanceof ApiError &&
            q.state.error.status === 0,
        ),
  );
  const reconnecting = useRuns((runs) => runs.some((r) => r.phase === "reconnecting"));
  const lost = useRuns((runs) => runs.some((r) => r.phase === "lost"));
  const retry = useCallback(() => {
    for (const r of runStore.getRuns()) if (r.phase === "lost") runDriver.reconnect(r.key);
    void client.refetchQueries({ type: "active" });
  }, [client]);
  const kind: ConnectionKind | null =
    netDown || lost ? "down" : reconnecting ? "reconnecting" : null;
  return { kind, retry };
}
