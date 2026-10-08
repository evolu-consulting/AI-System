// HUB-FR-101, HUB-FR-103 · X2b D10: luồng tin của thread chung — tin người (luôn ghi tên người gửi) và khối agent xen kẽ
// ("<B> hỏi" + "Chạy bằng quyền của <B>" theo từng lượt), run đang chạy của thread ở cuối. Cuộn lên tải tin cũ hơn.
import type { RoomActiveRun, RoomMessage } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { useStickyScroll } from "~/features/flow-panel/hooks/use-sticky-scroll";
import type { RoomTurnActions } from "../../hooks/use-answer-run";
import { AgentBlock } from "../agent/AgentBlock";
import { PendingRunItem } from "../agent/PendingRunItem";
import { MessageItem } from "../timeline/MessageItem";

export type RoomFlowMessagesProps = {
  messages: readonly RoomMessage[];
  myId: string;
  loading: boolean;
  hasOlder: boolean;
  loadOlder(): void;
  pending: readonly RoomActiveRun[];
  waiting: ReadonlySet<string>;
  onAnswer: RoomTurnActions["answer"];
  onRerun(message: RoomMessage): void;
};

const SKELETON = ["a", "b", "c"];

export function RoomFlowMessages(p: RoomFlowMessagesProps) {
  const { t } = useTranslation();
  const { scrollRef, contentRef, onScroll } = useStickyScroll({
    has: p.hasOlder,
    load: p.loadOlder,
  });
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={t("flow.log")}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div ref={contentRef} className="flex flex-col gap-1 p-4">
        {p.loading &&
          SKELETON.map((k) => <Skeleton key={k} aria-hidden className="my-1 h-10 w-2/3" />)}
        {p.messages.map((m) =>
          m.sender_type === "agent" ? (
            <AgentBlock
              key={m.id}
              message={m}
              myId={p.myId}
              inThread
              waiting={m.run_id !== undefined && p.waiting.has(m.run_id)}
              onAnswer={p.onAnswer}
              onRerun={p.onRerun}
            />
          ) : (
            <MessageItem key={m.id} message={m} mine={m.sender.id === p.myId} group />
          ),
        )}
        {p.pending.map((r) => (
          <PendingRunItem key={r.run_id} run={r} myId={p.myId} />
        ))}
      </div>
    </div>
  );
}
