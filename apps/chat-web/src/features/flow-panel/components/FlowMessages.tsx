// CHAT-AC-14..16 · luồng tin của khung flow: tin E11 (cuộn lên tải cũ hơn) + câu hỏi/trả lời của run đang chạy (stream, cold).
import { useTranslation } from "react-i18next";
import { ConsultantAvatar } from "~/components/shared/ConsultantAvatar";
import { Skeleton } from "~/components/ui/skeleton";
import { AnswerExtras } from "~/features/thread/components/AnswerExtras";
import { Answer } from "~/features/thread/components/FlowBlock";
import type { AnswerView } from "~/features/thread/lib/thread-logic";
import type { FlowPanelData } from "../hooks/use-flow-panel";
import { useStickyScroll } from "../hooks/use-sticky-scroll";
import type { PanelItem } from "../lib/flow-panel-logic";

function Question({ text }: { text: string }) {
  return (
    <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-[10px] bg-row-divider px-3 py-2">
      {text}
    </div>
  );
}

function Reply({ answer }: { answer: AnswerView }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ConsultantAvatar />
      <Answer answer={answer} />
      <AnswerExtras answer={answer} />
    </div>
  );
}

function Item({ item }: { item: PanelItem }) {
  return item.kind === "question" ? <Question text={item.text} /> : <Reply answer={item.answer} />;
}

function PanelSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-9 w-1/2 self-end rounded-[10px]" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

export function FlowMessages({ data }: { data: FlowPanelData }) {
  const { t } = useTranslation();
  const { scrollRef, contentRef, onScroll } = useStickyScroll({
    has: data.hasOlder,
    load: data.loadOlder,
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
      <div ref={contentRef} className="flex flex-col gap-4 p-4 text-body leading-[1.55]">
        {data.loading ? (
          <PanelSkeleton />
        ) : (
          data.items.map((item) => <Item key={item.id} item={item} />)
        )}
        {data.pendingQuestion !== null && <Question text={data.pendingQuestion} />}
        {data.pendingAnswer && <Reply answer={data.pendingAnswer} />}
      </div>
    </div>
  );
}
