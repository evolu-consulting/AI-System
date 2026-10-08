// HUB-FR-96 · một tin: người khác = avatar chữ cái + tên + giờ (tên chỉ ở nhóm); tin mình = "Bạn · giờ", lệch phải.
// Chuỗi `@xxx` giữ nguyên chữ (R16); `@key` đầu tin được tô. Tin của agent: X2b cắm FlowBlock; X2a không dựng gì.
import type { RoomMessage } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { leadingTag } from "~/features/agents/lib/mention";
import { cn } from "~/lib/utils";
import { initialsOf } from "../../../shell/lib/conversation-path";
import { timeOf } from "../../lib/room-logic";

/** Tô `@key` ở đầu tin (chữ giữ nguyên, R16); không tag → chữ thường. */
function Content({ text }: { text: string }) {
  const tag = leadingTag(text);
  if (tag === null) return <>{text}</>;
  return (
    <>
      <span className="font-semibold underline decoration-dotted underline-offset-2">{`@${tag}`}</span>
      {text.slice(tag.length + 1)}
    </>
  );
}

type Props = { message: RoomMessage; mine: boolean; group: boolean };

function MessageItemImpl({ message, mine, group }: Props) {
  const { t } = useTranslation();
  if (message.sender_type !== "user") return null; // AgentMessageSlot (X2b)
  const time = timeOf(message.created_at);
  const name = mine ? t("rooms.you") : message.sender.display_name;
  return (
    <article
      data-seq={message.seq}
      aria-label={t("rooms.msgMeta", { name, time })}
      className={cn("flex gap-2.5 py-1", mine && "flex-row-reverse")}
    >
      {!mine && (
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
        >
          {initialsOf(message.sender.display_name)}
        </span>
      )}
      <div className={cn("flex max-w-[75%] min-w-0 flex-col", mine && "items-end")}>
        <p className="mb-0.5 text-caption text-muted-foreground">
          {mine || group ? `${name} · ${time}` : time}
        </p>
        <p
          className={cn(
            "rounded-xl px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap",
            mine ? "bg-primary text-primary-foreground" : "border border-border bg-card",
          )}
        >
          <Content text={message.content} />
        </p>
      </div>
    </article>
  );
}

export const MessageItem = memo(MessageItemImpl);
