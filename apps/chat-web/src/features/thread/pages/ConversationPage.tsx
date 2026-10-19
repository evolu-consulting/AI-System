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
import { useBangSubmit } from "~/features/processes/composer/hooks/use-bang-submit";
import { ConversationRunCards } from "~/features/processes/run-block/components/ConversationRunCards";
import { ProcessEngineGate, useProcessEngine } from "~/features/processes/shared/engine";
import { useActiveRun } from "~/features/run/hooks/use-run-stream";
import { useSend } from "~/features/run/hooks/use-send";
import { useQuotaOver, useRuns } from "~/features/run/run-store";
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
  const quotaOver = useQuotaOver();
  const running = active?.origin === "main";
  // P-a FD4: `!key …` ở Hỏi AI đi `POST /process-runs` (PF1), không qua đường gửi run thường; cờ off ⇒ không chặn gì.
  const engine = useProcessEngine();
  const bang = useBangSubmit({ kind: "conversation", conversationId: convId }, engine);
  const onSubmit = useCallback(
    async (text: string, attachmentIds?: string[]) => {
      const hit = await bang.intercept(text, attachmentIds);
      if (hit !== "pass") return hit;
      const out = await send.sendMain(convId, text, attachmentIds);
      if (out.ok) onSent();
      return out;
    },
    [send, convId, onSent, bang],
  );
  return {
    running,
    processMenu: engine === "on",
    locked: active !== undefined && !running,
    quotaOver,
    onSubmit,
    onStop: () => void (active && send.cancel(active.key)),
  };
}

function ConversationView({ convId }: { convId: string }) {
  const { t } = useTranslation();
  const { flow: openFlowId } = routeApi.useSearch();
  const conv = useConversation(convId);
  const flows = useFlows(convId, openFlowId);
  const flowIds = useMemo(() => new Set(flows.flows.map((f) => f.id)), [flows.flows]);
  const pending = useRuns((runs) => pendingRunKeys(runs, convId, flowIds));
  const pendingKeys = useMemo(() => (pending ? pending.split(",") : []), [pending]);
  const autoscroll = useAutoscroll(useActiveRun(convId) !== undefined, {
    has: flows.hasNextPage,
    load: flows.loadOlder,
  });
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
          loadingOlder={flows.isFetchingNextPage}
          flows={flows.flows}
          pendingKeys={pendingKeys}
          openFlowId={openFlowId}
          autoscroll={autoscroll}
        />
        <div className="mx-auto w-full max-w-[800px] px-4 pt-3 pb-5 sm:px-6">
          <ProcessEngineGate>
            <ConversationRunCards conversationId={convId} />
          </ProcessEngineGate>
          <Composer variant="main" draftKey={mainDraftKey} autoFocus={!open.flow} {...composer} />
        </div>
      </div>
      {open.flow && (
        <FlowPane key={open.flow.id} convId={convId} flow={open.flow} onClose={open.close} />
      )}
    </div>
  );
}
