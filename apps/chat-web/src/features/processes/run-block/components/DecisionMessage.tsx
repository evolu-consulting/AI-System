// CHAT-AC-53 · plan-frontend-thread §3: tin `decision` — "Quy trình dừng ở giai đoạn …" + lý do; assignee/admin ⇒ DecisionCard, khác ⇒ TaskWaitingNote.
import type { ProcessRunFullView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { ReasonHint } from "../../shared/components/ReasonHint";
import { TaskWaitingNote } from "../../shared/components/TaskWaitingNote";
import { useThreadRun } from "../../shared/hooks/use-thread-run";
import { isAutofixReason, reasonKey, reasonParams } from "../../shared/lib/decision-reason";
import type { ThreadMessageProps } from "../../shared/types";
import { DecisionCard } from "./DecisionCard";

export type DecisionMessageProps = ThreadMessageProps<"decision">;

export function DecisionMessage({ part }: DecisionMessageProps) {
  const { t } = useTranslation();
  const runId = part.process_run_id;
  const { view: raw, slot } = useThreadRun(runId, part.task_id);
  const view = raw?.access === "full" ? (raw as ProcessRunFullView) : undefined;
  const stage = view?.stages[part.stage_idx]?.name ?? "";
  const stopped = t("process.thread.decision.stopped", { stage });
  return (
    <article
      aria-label={stopped}
      className="my-1.5 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4"
    >
      <p className="text-sm font-medium">{stopped}</p>
      {isAutofixReason(part.reason) ? (
        <h3 className="text-sm font-semibold">{t(reasonKey(part.reason))}</h3>
      ) : (
        <p className="text-caption text-secondary-foreground">
          {t(reasonKey(part.reason), reasonParams(part.reason))}
        </p>
      )}
      <ReasonHint reason={part.reason} />
      {slot.state === "mine" && (
        <DecisionCard runId={runId} task={slot.task} view={view} embedded />
      )}
      {slot.state === "waiting" && <TaskWaitingNote open={slot.open} />}
    </article>
  );
}
