// CHAT-AC-57 · plan-frontend-thread §3: tin loại `ask` trong thread — câu hỏi + chip + "lần hỏi n/max".
// Assignee ⇒ `AskTaskCard` external; người khác ⇒ chip khoá + `TaskWaitingNote`; việc đã đóng/chưa tải ⇒ chỉ câu hỏi (không `region`).
import { useTranslation } from "react-i18next";
import { TaskWaitingNote } from "../../shared/components/TaskWaitingNote";
import { useThreadRun } from "../../shared/hooks/use-thread-run";
import type { ThreadMessageProps } from "../../shared/types";
import { AskBody, AskRegion } from "./AskBody";
import { AskTaskCard } from "./AskTaskCard";

export type AskMessageProps = ThreadMessageProps<"ask">;

export function AskMessage({ message, part }: AskMessageProps) {
  const { t, i18n } = useTranslation();
  const { view, slot } = useThreadRun(part.process_run_id, part.task_id);
  const lang = i18n.language.startsWith("en") ? "en" : "vi";
  const agent = part.executor.name[lang];

  if (slot.state === "mine" && view?.access === "full") {
    return (
      <div data-seq={message.seq}>
        <AskTaskCard runId={part.process_run_id} task={slot.task} view={view} />
      </div>
    );
  }
  if (slot.state === "waiting") {
    const title = t("process.ask.title", { agent, n: part.asks_count, max: part.ask_limit });
    return (
      <div data-seq={message.seq}>
        <AskRegion title={title}>
          <AskBody question={part.question} choices={part.choices} />
          <TaskWaitingNote open={slot.open} />
        </AskRegion>
      </div>
    );
  }
  return (
    <article
      data-seq={message.seq}
      aria-label={t("process.ask.asked", { agent })}
      className="flex flex-col gap-1 py-1 text-sm"
    >
      <p className="text-caption font-medium text-muted-foreground">{agent}</p>
      <p className="whitespace-pre-wrap wrap-anywhere">{part.question}</p>
    </article>
  );
}
