// CHAT-AC-53 · plan-frontend-thread §3: tin `task_result` — dáng tin người + dòng kết quả (Đạt / Chưa đạt + góp ý / Đã trả lời / quyết định).
import { useTranslation } from "react-i18next";
import { timeOf } from "~/features/rooms/lib/room-logic";
import { initialsOf } from "~/features/shell/lib/conversation-path";
import type { ThreadMessageProps } from "../../shared/types";

export type TaskResultMessageProps = ThreadMessageProps<"task_result">;

export function TaskResultMessage({ message, part, myId }: TaskResultMessageProps) {
  const { t } = useTranslation();
  // E-P8/E-S1 (qc): kết quả `answer` ⇒ "Bạn" khi người xem là người làm, còn lại tên; `review` luôn ghi TÊN người
  // (bản ghi công việc, preview server cũng dùng tên; E-P4/E-P5/E-P12-thread thấy tên của người khác).
  const actor =
    part.result === "answer" && part.actor.id === myId
      ? t("process.ask.you")
      : part.actor.display_name;
  const time = timeOf(message.created_at);
  const resultLabel = t(`process.common.result.${part.result}`);
  return (
    <article
      aria-label={t("process.thread.result.aria", { actor, result: resultLabel, time })}
      data-seq={message.seq}
      className="my-1 flex gap-2.5 py-1"
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
      >
        {initialsOf(part.actor.display_name)}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
          <span className="font-medium text-foreground">{actor}</span>
          <span aria-hidden>·</span>
          <span className="font-medium text-foreground">{resultLabel}</span>
          <span aria-hidden>·</span>
          <span>{time}</span>
          {part.outside && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-strong-foreground">
              {t("process.thread.result.outside")}
            </span>
          )}
        </p>
        {(part.result === "fail" || part.result === "reject") && part.feedback && (
          <blockquote className="border-l-2 border-border pl-2 text-sm whitespace-pre-wrap wrap-anywhere text-secondary-foreground">
            {part.feedback}
          </blockquote>
        )}
        {part.result === "answer" && (part.answer || part.choice) && (
          <p className="text-sm whitespace-pre-wrap wrap-anywhere text-secondary-foreground">
            {part.answer || part.choice}
          </p>
        )}
        {part.sections && part.sections.length > 0 && (
          <p className="text-caption text-secondary-foreground">
            {t("process.thread.result.sections", { list: part.sections.join(", ") })}
          </p>
        )}
      </div>
    </article>
  );
}
