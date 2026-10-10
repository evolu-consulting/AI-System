// CHAT-AC-52 · plan-frontend §6: dòng trạng thái của khối/thanh (đổi trạng thái báo bằng `aria-live`). Trình bày thuần theo `view`.
import type { OpenTask, ProcessRunFullView, TaskKind } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { reasonKey, reasonParams } from "../../shared/lib/decision-reason";
import { waitNames } from "../../shared/lib/thread-task";
import { currentStage } from "../lib/block-view";

const hasMyOpen = (view: ProcessRunFullView, kind: TaskKind): boolean =>
  view.my_tasks.some((t) => t.kind === kind && t.status === "open");

function openWaitName(
  view: ProcessRunFullView,
  kind: TaskKind,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const open: OpenTask | undefined = view.open_tasks.find((o) => o.kind === kind);
  if (!open) return "";
  const w = waitNames(open);
  if (w.kind === "group") return t("process.thread.wait.group", { group: w.group });
  if (w.kind === "none") return "";
  return w.more > 0
    ? t("process.thread.wait.more", { first: w.names.join(", "), count: w.more })
    : w.names.join(", ");
}

/** `null` cho khối/dòng = run đã kết thúc (huy hiệu đã đủ nghĩa). */
function lineOf(
  view: ProcessRunFullView,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  const n = view.current_stage_idx + 1;
  const total = view.stages.length;
  switch (view.status) {
    case "running": {
      const cur = currentStage(view);
      if (cur?.status === "queued") return t("process.run.line.queued", { n, total });
      return t("process.run.line.running", { n, total, stage: cur?.name ?? "" });
    }
    case "waiting_review":
      return hasMyOpen(view, "review")
        ? t("process.run.line.reviewMe")
        : t("process.run.line.reviewOther");
    case "waiting_answer":
      return hasMyOpen(view, "ask")
        ? t("process.run.line.askMe")
        : t("process.run.line.askOther", { name: openWaitName(view, "ask", t) });
    case "needs_decision": {
      if (view.decision?.can_decide) return t("process.run.line.decideMe");
      const reason = view.decision
        ? t(reasonKey(view.decision.reason), reasonParams(view.decision.reason))
        : "";
      return t("process.run.line.decideOther", { reason });
    }
    default:
      return null;
  }
}

export function StatusLine({ view, className }: { view: ProcessRunFullView; className?: string }) {
  const { t } = useTranslation();
  const line = lineOf(view, t);
  if (!line) return null;
  return (
    <p aria-live="polite" className={className ?? "text-sm text-secondary-foreground"}>
      {line}
    </p>
  );
}
