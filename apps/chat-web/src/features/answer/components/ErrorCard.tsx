// CHAT-AC-24..27, CHAT-AC-30 · thẻ lỗi theo mã: câu i18n (không hiện message/hint thô), nút theo bảng, dòng `CODE · run id`.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { copyText } from "../lib/clipboard";
import { errorActions, errorBodyKey, errorTitleKey, reportText } from "../lib/error-map";

export type ErrorCardProps = {
  code: string;
  runId: string | null;
  /** Không có → ẩn Thử lại. */
  onRetry?: () => void;
};

export function ErrorCard({ code, runId, onRetry }: ErrorCardProps) {
  const { t } = useTranslation();
  const actions = errorActions(code);
  const bodyKey = errorBodyKey(code);
  const showRetry = actions.retry && onRetry !== undefined;
  const report = async () => {
    if (await copyText(reportText(code, runId))) toast.success(t("answer.copied"));
  };
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg bg-danger-bg p-3 text-danger">
      <p className="font-semibold">{t(errorTitleKey(code))}</p>
      {bodyKey && <p>{t(bodyKey)}</p>}
      {(showRetry || actions.report) && (
        <div className="flex gap-2">
          {showRetry && (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t("errors.retry")}
            </Button>
          )}
          {actions.report && (
            <Button type="button" size="sm" variant="outline" onClick={() => void report()}>
              {t("errors.report")}
            </Button>
          )}
        </div>
      )}
      <p className="font-mono text-caption">{t("errors.meta", { code, runId: runId ?? "—" })}</p>
    </div>
  );
}
