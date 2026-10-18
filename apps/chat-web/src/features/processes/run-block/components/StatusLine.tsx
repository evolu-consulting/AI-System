// CHAT-AC-52 · plan-frontend §6: dòng trạng thái của khối/thanh (đổi trạng thái báo bằng `aria-live`). Trình bày thuần theo `view`.
import {
  type OpenTask,
  type ProcessRunFullView,
  STAGE_RETRY_MAX,
  type TaskKind,
} from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { describeStageWait, earliestWait } from "../../domain/stage-wait";
import { formatWaitDateTime, type WaitLang } from "../../domain/wait-format";
import { reasonKey, reasonParams } from "../../shared/lib/decision-reason";
import { waitNames } from "../../shared/lib/thread-task";
import { currentStage, waitFacts } from "../lib/block-view";

const lngOf = (i18n: { language: string }): WaitLang => (i18n.language === "vi" ? "vi" : "en");

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

/** Dòng `waiting_timer` (hẹn sớm nhất) và `running` (kể cả đang thử lại). */
function timerOrRunningLine(
  view: ProcessRunFullView,
  tr: { t: ReturnType<typeof useTranslation>["t"]; i18n: { language: string } },
  pos: { n: number; total: number },
): string {
  const { t, i18n } = tr;
  const { n, total } = pos;
  const cur = currentStage(view);
  const stage = cur?.name ?? "";
  if (view.status === "waiting_timer") {
    const due = earliestWait(view.stages.map(waitFacts));
    return due
      ? t("process.run.line.waitingTimer", {
          date: formatWaitDateTime(due.dueAt, due.timeZone, lngOf(i18n)),
          n,
          total,
          stage,
        })
      : t("process.run.line.waitingTimerNoDate", { n, total });
  }
  const w = cur ? describeStageWait(waitFacts(cur)) : null;
  if (w?.kind === "retrying")
    return t("process.run.line.retrying", { retry: w.n, max: STAGE_RETRY_MAX, n, total, stage });
  if (cur?.status === "queued") return t("process.run.line.queued", { n, total });
  return t("process.run.line.running", { n, total, stage });
}

/** `null` cho khối/dòng = run đã kết thúc (huy hiệu đã đủ nghĩa). */
function lineOf(
  view: ProcessRunFullView,
  t: ReturnType<typeof useTranslation>["t"],
  i18n: ReturnType<typeof useTranslation>["i18n"],
): string | null {
  const n = view.current_stage_idx + 1;
  const total = view.stages.length;
  switch (view.status) {
    case "waiting_timer":
    case "running":
      return timerOrRunningLine(view, { t, i18n }, { n, total });
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
  const { t, i18n } = useTranslation();
  const line = lineOf(view, t, i18n);
  if (!line) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={className ?? "text-sm text-secondary-foreground"}
    >
      {line}
    </p>
  );
}
