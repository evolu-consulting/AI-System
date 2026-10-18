// HUB-FR-113 · plan-frontend §5 (A5): một dòng giai đoạn trong nhóm bước — trạng thái, bên làm, lần làm, người duyệt + thời gian.
import { STAGE_RETRY_MAX, type StageView } from "@ai/contracts/chat";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { describeStageWait, type StageWaitInfo } from "../../domain/stage-wait";
import { formatClock, formatWaitDateTime, type WaitLang } from "../../domain/wait-format";
import { waitFacts } from "../../run-block/lib/block-view";
import { formatDateTime } from "../../shared/lib/format";
import { stageStatusKey } from "../../shared/lib/status";
import { KnowledgeNotice } from "./KnowledgeNotice";

/** Trang Run: ngày giờ đầy đủ + múi giờ (FD7); "Đang thử lại (n/3) · giờ". */
function rowDetail(w: StageWaitInfo, t: TFunction, lng: WaitLang): string | null {
  if (w.kind === "waiting_date")
    return t("process.common.stageLabel.waitUntilAt", {
      date: formatWaitDateTime(w.dueAt, w.timeZone, lng),
      tz: w.timeZone,
    });
  if (w.kind !== "retrying") return null;
  const base = { n: w.n, max: STAGE_RETRY_MAX };
  const time = w.nextAt
    ? formatClock(w.nextAt, Intl.DateTimeFormat().resolvedOptions().timeZone, lng)
    : "";
  return time
    ? t("process.common.stageLabel.retryingAt", { ...base, time })
    : t("process.common.stageLabel.retrying", base);
}

export function StageRow({ stage }: { stage: StageView }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language === "vi" ? "vi" : "en";
  const detail = rowDetail(describeStageWait(waitFacts(stage)), t, lng);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-secondary-foreground">
        <span className="text-sm font-medium text-foreground">{stage.name}</span>
        <span>{t(stageStatusKey(stage.status))}</span>
        {detail && <span>{detail}</span>}
        <span>{t("process.run.pane.executor", { name: stage.executor.name[lng] })}</span>
        {stage.attempt > 1 && <span>{t("process.run.step.attempt", { n: stage.attempt })}</span>}
        {stage.passed_by && stage.passed_at && (
          <span>
            {t("process.run.review.closed", {
              name: stage.passed_by.display_name,
              result: t("process.common.result.pass"),
              time: formatDateTime(stage.passed_at, lng),
            })}
          </span>
        )}
      </div>
      <KnowledgeNotice knowledge={stage.knowledge} />
    </div>
  );
}
