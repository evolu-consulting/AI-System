// HUB-FR-72 · plan-frontend §3 "Mất mạng (mọi màn)": banner khi trình duyệt offline.
import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnline } from "../hooks/use-online";

export function OfflineBanner() {
  const { t } = useTranslation();
  if (useOnline()) return null;
  return (
    <div
      role="alert"
      className="flex items-center gap-2 bg-warning-bg px-6 py-2 text-label text-warning"
    >
      <WifiOff aria-hidden className="size-4" />
      {t("offline.banner")}
    </div>
  );
}
