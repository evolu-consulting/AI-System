// CHAT-AC-52 · D14: thẻ run của một hội thoại Hỏi AI (`GET /process-runs?conversation_id=`). Khoá `processKeys.runs("conv:…")`
// nằm dưới tiền tố `["process","runs"]` nên composer (F1) invalidate sau `POST /process-runs` là thẻ mới hiện.
import { useQuery } from "@tanstack/react-query";
import { processKeys } from "../../shared/keys";
import { listConversationRuns } from "../api";

const RUNS_STALE_MS = 10_000;

export function useConversationRuns(conversationId: string) {
  const q = useQuery({
    queryKey: processKeys.runs(`conv:${conversationId}`),
    queryFn: ({ signal }) => listConversationRuns(conversationId, signal),
    staleTime: RUNS_STALE_MS,
  });
  return { runs: q.data?.items ?? [], isPending: q.isPending, isError: q.isError };
}
