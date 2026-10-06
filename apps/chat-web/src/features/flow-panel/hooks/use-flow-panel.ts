// CHAT-AC-14..16 · dữ liệu khung flow: tin E11 + run của flow (stream, cold), gửi kèm `flow_id`, Dừng, bỏ run khi E11 đã có.
import type { Flow } from "@ai/contracts/chat";
import { useCallback, useEffect, useMemo } from "react";
import type { SubmitResult } from "~/features/composer/components/Composer";
import { useActiveRun, useRunStream } from "~/features/run/hooks/use-run-stream";
import { useSend } from "~/features/run/hooks/use-send";
import { answerFromRun } from "~/features/thread/lib/thread-logic";
import { buildItems, runOverlay, shouldDismissInPanel } from "../lib/flow-panel-logic";
import { useFlowMessages } from "./use-flow-messages";

function usePanelComposer(convId: string, flow: Flow) {
  const send = useSend();
  const active = useActiveRun(convId);
  const running = active !== undefined && active.flowId === flow.id;
  const { id, last_active_at } = flow;
  const onSubmit = useCallback(
    (text: string, attachmentIds?: string[]): Promise<SubmitResult> =>
      send.sendInFlow(convId, { id, last_active_at }, text, attachmentIds),
    [send, convId, id, last_active_at],
  );
  return {
    running,
    locked: active !== undefined && !running,
    onSubmit,
    onStop: () => void (active && send.cancel(active.key)),
  };
}

export function useFlowPanel(convId: string, flow: Flow) {
  const msgs = useFlowMessages(convId, flow.id);
  const { dismiss } = useSend();
  const run = useRunStream({
    convId,
    flowId: flow.id,
    activeRunId: flow.active_run_id,
    origin: "flow",
  });
  useEffect(() => {
    if (run && shouldDismissInPanel(run, msgs.ids, flow)) dismiss(run.key);
  }, [run, msgs.ids, flow, dismiss]);

  const overlay = runOverlay(run, msgs.ids);
  const more = overlay.question !== null;
  const items = useMemo(
    () => buildItems(msgs.messages, { convId, flowId: flow.id }, more),
    [msgs.messages, convId, flow.id, more],
  );
  return {
    items,
    loading: msgs.isPending,
    hasOlder: msgs.hasNextPage,
    loadOlder: () => {
      if (msgs.hasNextPage && !msgs.isFetchingNextPage) void msgs.fetchNextPage();
    },
    pendingQuestion: overlay.question,
    pendingAnswer: run && overlay.answer ? answerFromRun(run) : null,
    composer: usePanelComposer(convId, flow),
  };
}

export type FlowPanelData = ReturnType<typeof useFlowPanel>;
