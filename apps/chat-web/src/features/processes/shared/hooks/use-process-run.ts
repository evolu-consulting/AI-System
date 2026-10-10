// CR-056 · P-a FD9: view của run (`GET /process-runs/:id`). Realtime patch `status/stage_idx` rồi invalidate (không polling).
import { useQuery } from "@tanstack/react-query";
import { fetchRun } from "../api";
import { processKeys } from "../keys";
import { isActiveRun } from "../lib/status";

const ACTIVE_STALE_MS = 10_000;

export function useProcessRun(runId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: processKeys.run(runId ?? ""),
    queryFn: ({ signal }) => fetchRun(runId ?? "", signal),
    enabled: enabled && runId !== undefined,
    // Run kết thúc không đổi nữa: giữ mãi; đang chạy: 10 s (plan-frontend §8).
    staleTime: (q) =>
      q.state.data && !isActiveRun(q.state.data.status)
        ? Number.POSITIVE_INFINITY
        : ACTIVE_STALE_MS,
  });
}
