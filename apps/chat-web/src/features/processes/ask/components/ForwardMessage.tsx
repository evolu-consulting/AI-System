// CHAT-AC-57 · HUB-FR-111 · plan-frontend-thread §3: tin `forward` — một dòng nhẹ, khoá theo `task_kind` (không có lời nhắn).
import { FORWARD_CHAIN_MAX } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import type { ThreadMessageProps } from "../../shared/types";

export type ForwardMessageProps = ThreadMessageProps<"forward">;

export function ForwardMessage({ message, part, myId }: ForwardMessageProps) {
  const { t } = useTranslation();
  const key = part.task_kind === "ask" ? "process.ask.fwd.line" : "process.thread.forward.line";
  const from = part.from.id === myId ? t("process.ask.you") : part.from.display_name;
  return (
    <p data-seq={message.seq} className="py-0.5 text-caption text-muted-foreground">
      {t(key, { from, to: part.to.display_name, depth: part.depth, max: FORWARD_CHAIN_MAX })}
    </p>
  );
}
