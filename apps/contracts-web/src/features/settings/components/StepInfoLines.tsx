// CR-108 · dòng thông tin của một bước duyệt (dùng chung canvas và danh sách): "Hạn 24 giờ · nhắc mỗi 8 giờ", "3 người duyệt",
// "Quá hạn ⇒ chuyển <nhóm>". Thông tin vắng (null) ⇒ ẩn dòng, không hiện số 0 giả.
import { useTranslation } from "react-i18next";
import type { StepInfo } from "../lib/flow-canvas";

export function StepInfoLines({ info, className = "" }: { info: StepInfo; className?: string }) {
  const { t } = useTranslation();
  const line = "truncate text-caption text-dim";
  return (
    <>
      {info.dueH !== null && (
        <span className={`${line} ${className}`} data-testid="step-due">
          {info.remindH !== null
            ? t("contracts.flow.current.info.dueRemind", { due: info.dueH, remind: info.remindH })
            : t("contracts.flow.current.info.due", { due: info.dueH })}
        </span>
      )}
      {info.approvers !== null && (
        <span className={`${line} ${className}`} data-testid="step-approvers">
          {t(`contracts.flow.current.info.${info.approvers === 1 ? "approver" : "approvers"}`, {
            count: info.approvers,
          })}
        </span>
      )}
      {info.escalateMissing && (
        <span
          role="alert"
          className={`truncate text-caption text-late ${className}`}
          data-testid="step-escalate-missing"
        >
          {t("contracts.flow.current.info.escalateMissing")}
        </span>
      )}
      {info.escalate && !info.escalateMissing && (
        <span className={`${line} ${className}`} data-testid="step-escalate" title={info.escalate}>
          {t(
            info.escalateDefault
              ? "contracts.flow.current.info.escalateDefault"
              : "contracts.flow.current.info.escalate",
            { group: info.escalate },
          )}
        </span>
      )}
    </>
  );
}
