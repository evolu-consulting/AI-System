// CHAT-AC-05..07, CHAT-AC-20 · `/c/:id`: tiêu đề + "{n} flow", luồng khối flow (E7 + E10), composer chính (ô chính → flow mới).
// CHAT-AC-14..17 · `?flow=` → khung flow (FlowPanel ≥ 640 / FlowSheet < 640) cạnh cột chính.
import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { prefetchMarkdown } from "~/features/answer/components/AnswerBody";
import { Composer } from "~/features/composer/components/Composer";
import { useDraftKey } from "~/features/composer/hooks/use-draft";
import { FlowPane } from "~/features/flow-panel/components/FlowPane";
import { useOpenFlow } from "~/features/flow-panel/hooks/use-open-flow";
import { useActiveRun } from "~/features/run/hooks/use-run-stream";
import { useSend } from "~/features/run/hooks/use-send";
import { useRuns } from "~/features/run/run-store";
import { NotFoundState } from "../components/NotFoundState";
import { ThreadView } from "../components/ThreadView";
import { useAutoscroll } from "../hooks/use-autoscroll";
import { isNotFound, useConversation, useFlows } from "../hooks/use-thread";
import { pendingRunKeys } from "../lib/thread-logic";

const routeApi = getRouteApi("/_authed/c/$id");

export function ConversationPage() {
  const { id } = routeApi.useParams();
  // key theo id: đổi hội thoại → trạng thái cuộn/bám đáy làm lại từ đầu.
  return <ConversationView key={id} convId={id} />;
}

function useMainComposer(convId: string, onSent: () => void) {
  const send = useSend();
  const active = useActiveRun(convId);
  const lastMain = useRuns((runs) =>
    runs.findLast((r) => r.convId === convId && r.origin === "main"),
  );
  const running = active?.origin === "main";
  const onSubmit = useCallback(
    async (text: string) => {
      const out = await send.sendMain(convId, text);
      if (out.ok) onSent();
      return out;
    },
    [send, convId, onSent],
  );
  return {
    running,
    locked: active !== undefined && !running,
    quotaOver: lastMain?.quota?.state === "over",
    onSubmit,
    onStop: () => void (active && send.cancel(active.key)),
  };
}

function ConversationView({ convId }: { convId: string }) {
  const { t } = useTranslation();
  const { flow: openFlowId } = routeApi.useSearch();
  const conv = useConversation(convId);
  const flows = useFlows(convId);
  const flowIds = useMemo(() => new Set(flows.flows.map((f) => f.id)), [flows.flows]);
  const pending = useRuns((runs) => pendingRunKeys(runs, convId, flowIds));
  const pendingKeys = useMemo(() => (pending ? pending.split(",") : []), [pending]);
  const autoscroll = useAutoscroll(useActiveRun(convId) !== undefined);
  const composer = useMainComposer(convId, autoscroll.scrollToBottom);
  const open = useOpenFlow(convId, openFlowId, flows);
  const mainDraftKey = useDraftKey(convId, null);

  useEffect(() => prefetchMarkdown(), []);

  if (isNotFound(conv.error) || isNotFound(flows.error)) return <NotFoundState />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-[1_1_0] flex-col">
        <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
          <h1 className="truncate text-card-title font-semibold">{conv.data?.title ?? ""}</h1>
          {conv.data && (
            <span className="shrink-0 rounded-full bg-row-divider px-2 py-0.5 text-caption text-muted-foreground">
              {t("thread.flowCount", { count: conv.data.flow_count })}
            </span>
          )}
        </header>
        <ThreadView
          convId={convId}
          loading={flows.isPending}
          flows={flows.flows}
          pendingKeys={pendingKeys}
          openFlowId={openFlowId}
          autoscroll={autoscroll}
        />
        <div className="mx-auto w-full max-w-[800px] px-4 pb-5 sm:px-6">
          <Composer variant="main" draftKey={mainDraftKey} autoFocus={!open.flow} {...composer} />
        </div>
      </div>
      {open.flow && (
        <FlowPane key={open.flow.id} convId={convId} flow={open.flow} onClose={open.close} />
      )}
    </div>
  );
}
