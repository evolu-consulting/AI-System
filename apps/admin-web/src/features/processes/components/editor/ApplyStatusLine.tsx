// CR-123 FR-10 · MỘT dòng trạng thái duy nhất trong thanh lưu của bản công ty (CEO u9): lỗi (kèm cách sửa) › đang áp dụng ›
// chưa lưu › đã áp dụng › chưa áp dụng › ghi chú phạm vi. Không chồng nhiều dòng.
import { useTranslation } from "react-i18next";
import type { ApplyStatus } from "../../hooks/use-apply-flow";
import { useRecordWords } from "../flow/flow-ctx";

export function ApplyStatusLine({
  status,
  needsApply,
  dirty,
}: {
  status: ApplyStatus;
  needsApply: boolean;
  dirty: boolean;
}) {
  const { t } = useTranslation();
  const words = useRecordWords(); // CR-125 · c6 · "hợp đồng" / "bài đăng"… theo sự kiện của flow
  const line = (key: string, cls = "") => (
    <span className={`block ${cls}`.trim()} data-testid="apply-status">
      {t(key, words)}
    </span>
  );
  if (status.kind === "error")
    return (
      <span role="alert" className="block text-destructive" data-testid="apply-status">
        {t(`tenants.companyFlows.err.${status.key}`)}
      </span>
    );
  if (status.kind === "pending") return line("process.admin.editor.applyPending");
  if (dirty) return line("common.unsaved");
  if (status.kind === "applied")
    return (
      <span role="status" className="block font-medium text-success" data-testid="apply-status">
        {t("process.admin.editor.applied", words)}
      </span>
    );
  return line(needsApply ? "process.admin.editor.notApplied" : "process.admin.editor.applyNote");
}
