// CHAT-AC-52 · plan-frontend-thread §3: danh sách tin của thread quy trình (`role="log"`, `useStickyScroll`).
// Tin người = `MessageItem` (X2b); tin `process` = `ProcessThreadMessage` (rẽ 7 loại).
import type { RoomMessage } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { useStickyScroll } from "~/features/flow-panel/hooks/use-sticky-scroll";
import { MessageItem } from "~/features/rooms/components/timeline/MessageItem";
import { ProcessThreadMessage } from "../../shared/thread/ProcessThreadMessage";

export type ProcessFlowMessagesProps = {
  roomId: string;
  myId: string;
  messages: readonly RoomMessage[];
  loading: boolean;
  hasOlder: boolean;
  loadOlder(): void;
};

const SKELETON = ["a", "b", "c"];

export function ProcessFlowMessages(p: ProcessFlowMessagesProps) {
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
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div ref={contentRef} className="flex flex-col gap-1 p-4">
        {p.loading &&
          SKELETON.map((k) => <Skeleton key={k} aria-busy="true" className="my-1 h-10 w-2/3" />)}
        {p.messages.map((m) =>
          m.sender_type === "process" ? (
            <ProcessThreadMessage key={m.id} message={m} roomId={p.roomId} myId={p.myId} />
          ) : (
            <MessageItem key={m.id} message={m} mine={m.sender.id === p.myId} group />
          ),
        )}
      </div>
    </div>
  );
}
