// CR-056 · P-a plan-frontend-thread §4 + P-b2 plan-frontend §3 (CHAT-AC-59): thanh giai đoạn theo BƯỚC. Mỗi bước là một
// `<li>`; bước nhiều giai đoạn chứa `<ul>` "Bước n — chạy song song". Thiếu `step` ⇒ y như P-a (mỗi giai đoạn một bước).
// ×lần (PB2-R13) cạnh tên giai đoạn đã làm lại; dòng "↩ Quay lại bước x (lần n)" dưới thanh. Trình bày thuần.
import { STAGE_RETRY_MAX, type StageRunStatus } from "@ai/contracts/chat";
import type { TFunction } from "i18next";
import { Clock } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import type { StageWaitInfo } from "../../domain/stage-wait";
import {
  formatClock,
  formatWaitDate,
  formatWaitDateTime,
  type WaitLang,
} from "../../domain/wait-format";
import { stageStatusKey } from "../lib/status";
import { groupBySteps, showSteps, stepNo } from "../lib/steps";

export type StageStripItem = {
  idx: number;
  name: string;
  status: StageRunStatus;
  /** 0-based; vắng ⇒ = idx. */
  step?: number;
  round?: number;
  /** P-d1: chờ hẹn / thử lại / bỏ qua suy từ `StageView` (`describeStageWait`); vắng ⇒ như cũ. */
  wait?: StageWaitInfo;
};

/** Vệt quay lại dưới thanh: sự kiện mới nhất (`step` = số UI) + tổng số lần; `max` ⇒ đã hết lượt. */
export type StageStripBack = { step?: number; count?: number; max?: number };

const DOT: Partial<Record<StageRunStatus, string>> = {
  done: "bg-success",
  running: "bg-primary",
  queued: "bg-primary/50",
  waiting_review: "bg-warning-solid",
  waiting_answer: "bg-warning-solid",
  needs_decision: "bg-destructive",
  failed: "bg-destructive",
};

function Round({ n }: { n: number }) {
  const { t } = useTranslation();
  if (n <= 1) return null;
  return (
    <span className="rounded-sm bg-muted px-1 text-caption font-medium text-secondary-foreground">
      <span aria-hidden>{t("process.run.step.round", { n })}</span>
      <span className="sr-only"> {t("process.run.step.roundSr", { count: n - 1 })}</span>
    </span>
  );
}

/** Chi tiết chờ/thử lại/bỏ qua (FD6, FD7): chữ + `title` (ngày giờ + múi giờ). `none` ⇒ null. */
function waitDetail(
  w: StageWaitInfo,
  t: TFunction,
  lng: WaitLang,
): { text: string; title?: string } | null {
  switch (w.kind) {
    case "waiting_date":
      return {
        text: t("process.common.stageLabel.waitUntil", {
          date: formatWaitDate(w.dueAt, w.timeZone, lng),
        }),
        title: t("process.common.stageLabel.waitUntilAt", {
          date: formatWaitDateTime(w.dueAt, w.timeZone, lng),
          tz: w.timeZone,
        }),
      };
    case "waiting":
      return { text: t("process.common.status.waiting_timer") };
    case "skipped":
      return { text: t("process.common.stage.skipped") };
    case "retrying": {
      const base = { n: w.n, max: STAGE_RETRY_MAX };
      const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const time = w.nextAt ? formatClock(w.nextAt, viewerTz, lng) : "";
      return {
        text: time
          ? t("process.common.stageLabel.retryingAt", { ...base, time })
          : t("process.common.stageLabel.retrying", base),
      };
    }
    default:
      return null;
  }
}

function Stage({ s }: { s: StageStripItem }) {
  const { t, i18n } = useTranslation();
  const detail = s.wait ? waitDetail(s.wait, t, i18n.language === "vi" ? "vi" : "en") : null;
  const timer = s.wait?.kind === "waiting_date" || s.wait?.kind === "waiting";
  const skipped = s.wait?.kind === "skipped";
  return (
    <span className="flex items-center gap-1.5" title={detail?.title}>
      {timer ? (
        <Clock aria-hidden className="size-3 shrink-0 text-primary" />
      ) : (
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", DOT[s.status] ?? "bg-border")}
        />
      )}
      <span
        className={cn(
          (s.status === "pending" || skipped) && "text-muted-foreground",
          skipped && "line-through",
        )}
      >
        {s.name}
      </span>
      <Round n={s.round ?? 1} />
      {detail ? (
        <span className="text-muted-foreground">· {detail.text}</span>
      ) : (
        <span className="sr-only">{t(stageStatusKey(s.status))}</span>
      )}
    </span>
  );
}

function BackTrail({ back }: { back: StageStripBack }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap gap-x-3 text-caption text-warning">
      {back.step !== undefined && (
        <span>{t("process.run.step.backLine", { step: back.step, n: back.count ?? 1 })}</span>
      )}
      {back.max !== undefined && <span>{t("process.run.step.backMax", { max: back.max })}</span>}
    </p>
  );
}

export const StageStrip = memo(function StageStrip({
  stages,
  back,
  className,
}: {
  stages: readonly StageStripItem[];
  back?: StageStripBack;
  className?: string;
}) {
  const { t } = useTranslation();
  const groups = groupBySteps(stages);
  const labelled = showSteps(stages);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <ol
        aria-label={t("process.run.step.listAria")}
        className="flex flex-wrap items-start gap-x-3 gap-y-1"
      >
        {groups.map((g) => (
          <li
            key={g.step}
            className="flex items-start gap-1.5 text-caption text-secondary-foreground"
          >
            {labelled && (
              <span className="font-medium text-muted-foreground">
                {t("process.run.step.title", { n: stepNo(g.step) })}
              </span>
            )}
            {g.items.length > 1 ? (
              <ul
                aria-label={t("process.run.step.parallelAria", { n: stepNo(g.step) })}
                className="flex flex-col gap-0.5 border-l border-border pl-2"
              >
                {g.items.map((s) => (
                  <li key={s.idx}>
                    <Stage s={s} />
                  </li>
                ))}
              </ul>
            ) : (
              g.items[0] && <Stage s={g.items[0]} />
            )}
          </li>
        ))}
      </ol>
      {back && (back.step !== undefined || back.max !== undefined) && <BackTrail back={back} />}
    </div>
  );
});
