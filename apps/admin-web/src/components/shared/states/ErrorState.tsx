// ADM-FR-60 · lỗi tải: `alert` "Không tải được dữ liệu" + "{message} (mã {code})" + Thử lại.
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = { message: string; code: string; onRetry?: () => void };

export function ErrorState({ message, code, onRetry }: Props) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive" className="flex items-start gap-3">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1 space-y-1">
        <AlertTitle>{t("state.error.title")}</AlertTitle>
        <AlertDescription>{t("state.error.body", { message, code })}</AlertDescription>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </Alert>
  );
}
