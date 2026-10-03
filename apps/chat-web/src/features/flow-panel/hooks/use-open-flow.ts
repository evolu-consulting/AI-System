// CHAT-AC-14, CHAT-AC-17 · `?flow=` → flow đang mở; flow lạ (đã tải hết E10 mà không có) → bỏ param; đóng → xoá `?flow`, trả focus "Trả lời tiếp".
import type { Flow } from "@ai/contracts/chat";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

type FlowsState = { flows: readonly Flow[]; isPending: boolean; hasNextPage: boolean };

function focusReply(flowId: string): void {
  requestAnimationFrame(() => {
    const sel = `article[data-flow-id="${CSS.escape(flowId)}"] [data-flow-reply]`;
    document.querySelector<HTMLElement>(sel)?.focus();
  });
}

export function useOpenFlow(convId: string, openFlowId: string | undefined, state: FlowsState) {
  const navigate = useNavigate();
  const flow = openFlowId ? state.flows.find((f) => f.id === openFlowId) : undefined;
  const unknown = openFlowId !== undefined && !flow && !state.isPending && !state.hasNextPage;
  const clear = useCallback(
    (replace: boolean) => navigate({ to: "/c/$id", params: { id: convId }, search: {}, replace }),
    [navigate, convId],
  );
  useEffect(() => {
    if (unknown) void clear(true);
  }, [unknown, clear]);
  const close = useCallback(() => {
    void clear(false);
    if (openFlowId) focusReply(openFlowId);
  }, [clear, openFlowId]);
  return { flow, close };
}
