// CHAT-AC-14 · tin của flow đang mở: infinite `['flow', flowId, 'messages']` (E11, cursor cũ hơn khi cuộn lên).
// Run kết thúc → runtime invalidate `['flow', flowId]` → làm mới.
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listFlowMessages } from "../api";
import { orderMessages } from "../lib/flow-panel-logic";

export function useFlowMessages(convId: string, flowId: string) {
  const query = useInfiniteQuery({
    queryKey: ["flow", flowId, "messages"],
    queryFn: ({ pageParam, signal }) => listFlowMessages(convId, flowId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const messages = useMemo(() => orderMessages(query.data?.pages), [query.data]);
  const ids = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);
  return { ...query, messages, ids };
}
