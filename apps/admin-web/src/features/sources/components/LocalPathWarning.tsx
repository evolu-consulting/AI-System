// ADM-FR-68 · PB-R21 · cảnh báo BẮT BUỘC của nguồn đường dẫn cục bộ: `role="alert"` tĩnh, luôn hiện (form local_path + chế độ xem).

import { Alert, AlertDescription } from "@ai/web-kit/ui/kit/alert";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

export function LocalPathWarning() {
  const { t } = useTranslation();
  return (
    <Alert className="border-warning-solid/40 bg-warning-bg text-warning">
      <TriangleAlert aria-hidden />
      <AlertDescription className="text-warning">
        {t("process.sources.local.warning")}
      </AlertDescription>
    </Alert>
  );
}
