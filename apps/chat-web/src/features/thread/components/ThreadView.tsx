// CHAT-AC-05, CHAT-AC-07, CHAT-AC-20 · luồng chính (`role=log`, tự cuộn): các khối flow theo E10 + khối tạm của run vừa gửi.
import type { Flow } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { useAutoscroll } from "../hooks/use-autoscroll";
import { useFlowBlock, usePendingBlock } from "../hooks/use-flow-block";
import { FlowBlock } from "./FlowBlock";
import { NewMessagesButton } from "./NewMessagesButton";
import { ThreadSkeleton } from "./ThreadSkeleton";

const FlowItem = memo(function FlowItem(p: { convId: string; flow: Flow; openFlowId?: string }) {
  return <FlowBlock {...useFlowBlock(p.convId, p.flow, p.openFlowId)} />;
});

const PendingItem = memo(function PendingItem({ runKey }: { runKey: string }) {
  const props = usePendingBlock(runKey);
  return props ? <FlowBlock {...props} /> : null;
});

export type ThreadViewProps = {
  convId: string;
  loading: boolean;
  flows: Flow[];
  pendingKeys: string[];
  openFlowId?: string;
  autoscroll: ReturnType<typeof useAutoscroll>;
};

export function ThreadView(props: ThreadViewProps) {
  const { t } = useTranslation();
  const { scrollRef, contentRef, onScroll, scrollToBottom, showNew } = props.autoscroll;
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("thread.log")}
        aria-busy={props.loading || undefined}
        onScroll={onScroll}
        className="h-full overflow-y-auto"
      >
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-[800px] flex-col gap-4 p-4 sm:p-6"
        >
          {props.loading && <ThreadSkeleton />}
          {props.flows.map((f) => (
            <FlowItem key={f.id} convId={props.convId} flow={f} openFlowId={props.openFlowId} />
          ))}
          {props.pendingKeys.map((k) => (
            <PendingItem key={k} runKey={k} />
          ))}
        </div>
      </div>
      {showNew && <NewMessagesButton onClick={scrollToBottom} />}
    </div>
  );
}
