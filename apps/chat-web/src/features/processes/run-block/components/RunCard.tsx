// CHAT-AC-52 · plan-frontend §3/§6 (D14): thẻ run ở Hỏi AI — trạng thái + nút → `/runs/$id`. Chỉ còn cho hội thoại (phòng dùng thread).
import type { ProcessRunStatus, ProcessRunSummary } from "@ai/contracts/chat";
import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { RunStatusBadge } from "../../shared/components/RunStatusBadge";
import { reasonKey, reasonParams } from "../../shared/lib/decision-reason";

export type RunCardProps = { run: ProcessRunSummary };

const ACTION_KEY: Record<ProcessRunStatus, string> = {
  running: "process.run.action.view",
  waiting_review: "process.run.action.review",
  waiting_answer: "process.run.action.answer",
  needs_decision: "process.run.action.decide",
  done: "process.run.action.result",
  cancelled: "process.run.action.detail",
  failed: "process.run.action.detail",
  expired: "process.run.action.detail",
};

function lineOf(run: ProcessRunSummary, t: ReturnType<typeof useTranslation>["t"]): string | null {
  switch (run.status) {
    case "running":
      return t("process.run.line.next", { n: run.current_stage_idx + 1 });
    case "waiting_review":
      return t("process.run.review.waiting");
    case "waiting_answer":
      return t("process.ask.waitingAny");
    case "needs_decision":
      return t("process.run.line.decideOther", {
        reason: run.decision_reason
          ? t(reasonKey(run.decision_reason), reasonParams(run.decision_reason))
          : "",
      });
    default:
      return null;
  }
}

function RunCardImpl({ run }: RunCardProps) {
  const { t } = useTranslation();
  const line = lineOf(run, t);
  return (
    <article
      aria-label={t("process.run.card.aria", { name: run.process.name })}
      data-run-id={run.id}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-foreground">
          {t("process.run.card.title", { name: run.process.name })}
        </span>
        <RunStatusBadge status={run.status} />
      </div>
      {line && <p className="text-caption text-secondary-foreground">{line}</p>}
      <Link
        to="/runs/$id"
        params={{ id: run.id }}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
      >
        {t(ACTION_KEY[run.status])}
      </Link>
    </article>
  );
}

export const RunCard = memo(RunCardImpl);
