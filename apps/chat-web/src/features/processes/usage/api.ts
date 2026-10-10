// CHAT-AC-58 · HUB-FR-116 · P-a PF4: nơi duy nhất gọi `GET /process-runs/:id/usage`.
import { type ProcessRunUsage, ProcessRunUsageSchema } from "@ai/contracts/chat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "~/lib/http";
import { processKeys } from "../shared/keys";

const STALE_MS = 15_000;

export async function fetchRunUsage(id: string, signal?: AbortSignal): Promise<ProcessRunUsage> {
  return ProcessRunUsageSchema.parse(
    await api<unknown>(`/process-runs/${encodeURIComponent(id)}/usage`, { signal }),
  );
}

/** Tải token; khi view của run bị làm tươi (`process.updated`…) thì token cũng được làm tươi. */
export function useRunUsage(runId: string) {
  const client = useQueryClient();
  useEffect(() => {
    const runKey = processKeys.run(runId);
    return client.getQueryCache().subscribe((ev) => {
      if (
        ev.type === "updated" &&
        ev.action.type === "invalidate" &&
        ev.query.queryKey[2] === runId &&
        ev.query.queryKey[1] === runKey[1]
      ) {
        void client.invalidateQueries({
          queryKey: processKeys.usage(runId),
          refetchType: "active",
        });
      }
    });
  }, [client, runId]);
  return useQuery({
    queryKey: processKeys.usage(runId),
    queryFn: ({ signal }) => fetchRunUsage(runId, signal),
    staleTime: STALE_MS,
  });
}
