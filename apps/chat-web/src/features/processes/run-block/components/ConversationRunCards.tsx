// CHAT-AC-52 · plan-frontend §2/§3 (FD4): các thẻ run của một hội thoại Hỏi AI, đặt trên khung nhập. Rỗng ⇒ không vẽ gì.
import { useTranslation } from "react-i18next";
import { useConversationRuns } from "../hooks/use-room-runs";
import { RunCard } from "./RunCard";

export type ConversationRunCardsProps = { conversationId: string };

export function ConversationRunCards({ conversationId }: ConversationRunCardsProps) {
  const { t } = useTranslation();
  const { runs } = useConversationRuns(conversationId);
  if (runs.length === 0) return null;
  return (
    <section aria-label={t("process.run.conversation.title")} className="mb-3 flex flex-col gap-2">
      {runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </section>
  );
}
