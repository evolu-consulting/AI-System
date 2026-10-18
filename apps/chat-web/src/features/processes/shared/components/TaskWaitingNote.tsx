// CR-056 · P-a plan-frontend-thread §2: người không phải assignee chỉ thấy "Đang chờ … " (`role="status"`, cùng dáng WaitingNote).
import type { OpenTask } from "@ai/contracts/chat";
import { Hourglass } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { reviewWaitVariant } from "../../domain/escalation";
import { waitNames } from "../lib/thread-task";

const SENTENCE = {
  review: "process.thread.wait.review",
  ask: "process.thread.wait.ask",
  decision: "process.thread.wait.decide",
} as const;

export const TaskWaitingNote = memo(function TaskWaitingNote({ open }: { open: OpenTask }) {
  const { t } = useTranslation();
  const w = waitNames(open);
  if (w.kind === "none") {
    return <Note text={t("process.common.status.needs_decision")} />;
  }
  const names =
    w.kind === "group"
      ? t("process.thread.wait.group", { group: w.group })
      : w.more > 0
        ? t("process.thread.wait.more", { first: w.names.join(", "), count: w.more })
        : w.names.join(", ");
  if (reviewWaitVariant({ escalatedGroup: open.escalated_group?.name }) === "escalated") {
    return (
      <Note
        text={t("process.thread.wait.reviewEscalated", {
          names,
          escalated: open.escalated_group?.name ?? "",
        })}
      />
    );
  }
  return <Note text={t(SENTENCE[open.kind], { names })} />;
});

function Note({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-caption text-secondary-foreground"
    >
      <Hourglass className="size-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}
