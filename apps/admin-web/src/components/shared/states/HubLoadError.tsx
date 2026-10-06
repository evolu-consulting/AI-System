// ADM-FR-37 · lỗi tải từ Hub (plan-frontend §2.3/§2.4): câu riêng + "Thử lại"; "Chưa cấu hình" khi vắng PUBLIC_HUB_URL.
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function HubLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive" className="flex items-center gap-3">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <AlertDescription className="flex-1">{message}</AlertDescription>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </Alert>
  );
}

export function HubNotConfigured() {
  const { t } = useTranslation();
  return <p className="text-body text-muted-foreground">{t("hub.notConfigured")}</p>;
}
