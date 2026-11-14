// CR-162: cụm lựa chọn của thẻ «Không đọc được hợp đồng này» — MỘT nút chính «Nhập tay» + nút menu «⋯» chứa Thử lại / Tải tệp khác. Chỉ trình bày.
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PopMenu } from "~/components/shared/pop-menu";

export function FailedActions({
  pending,
  onManual,
  onRetry,
  onPickFile,
}: {
  pending: boolean;
  onManual: () => void;
  onRetry: () => void;
  /** Mở hộp chọn tệp (input nằm ngoài menu để còn tồn tại sau khi menu đóng). */
  onPickFile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1" data-testid="failed-actions">
      <button
        type="button"
        className="btn btn-primary"
        data-testid="manual-entry"
        disabled={pending}
        onClick={onManual}
      >
        {t("contracts.review.manual")}
      </button>
      <PopMenu
        trigger={<MoreHorizontal size={18} aria-hidden />}
        ariaLabel={t("contracts.review.moreChoices")}
        triggerClass="btn-icon-ghost"
        triggerTestId="failed-more"
        items={[
          {
            key: "retry",
            label: t("contracts.gapa1.reextract.retry"),
            testId: "reextract",
            onSelect: onRetry,
          },
          {
            key: "replace",
            label: t("contracts.review.replaceFile"),
            testId: "replace-file-item",
            onSelect: onPickFile,
          },
        ]}
      />
    </div>
  );
}
