// CR-123 FR-10 · một dòng trạng thái áp dụng trong thanh lưu của bản công ty (đã áp dụng / đang áp dụng / chưa áp dụng / lỗi + cách sửa).
import { useTranslation } from "react-i18next";
import type { ApplyStatus } from "../../hooks/use-apply-flow";

export function ApplyStatusLine({
  status,
  needsApply,
}: {
  status: ApplyStatus;
  needsApply: boolean;
}) {
  const { t } = useTranslation();
  if (status.kind === "error")
    return (
      <span role="alert" className="block text-destructive" data-testid="apply-status">
        {t(`tenants.companyFlows.err.${status.key}`)}
      </span>
    );
  if (status.kind === "pending")
    return (
      <span className="block" data-testid="apply-status">
        {t("process.admin.editor.applyPending")}
      </span>
    );
  if (status.kind === "applied")
    return (
      <span role="status" className="block font-medium text-success" data-testid="apply-status">
        {t("process.admin.editor.applied")}
      </span>
    );
  return needsApply ? (
    <span className="block" data-testid="apply-status">
      {t("process.admin.editor.notApplied")}
    </span>
  ) : null;
}
