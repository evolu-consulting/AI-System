// HUB-FR-113 · plan-frontend §5 (A5): một dòng giai đoạn trong nhóm bước — trạng thái, bên làm, lần làm, người duyệt + thời gian.
import type { StageView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../shared/lib/format";
import { stageStatusKey } from "../../shared/lib/status";

export function StageRow({ stage }: { stage: StageView }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language === "vi" ? "vi" : "en";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-secondary-foreground">
      <span className="text-sm font-medium text-foreground">{stage.name}</span>
      <span>{t(stageStatusKey(stage.status))}</span>
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
  );
}
