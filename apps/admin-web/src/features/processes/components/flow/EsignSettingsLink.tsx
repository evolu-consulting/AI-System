// CR-123 · FR-13 (ux-audit #12): nhà cung cấp ký số chọn ở MỘT nơi — Cài đặt › Ký số của app Hợp đồng; bước Ký số chỉ hiện
// "Ký bằng: <nhà cung cấp mặc định>" và liên kết này mở nơi đổi (tab mới, chuyển phiên bằng mã một lần như bộ chuyển app).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { fetchMyApps, openApp } from "@/features/shell/hooks/use-apps";

export function EsignSettingsLink() {
  const { t } = useTranslation();
  const open = async () => {
    const app = (await fetchMyApps()).find((a) => a.key === "contracts");
    if (app) await openApp(app, "/settings", true);
  };
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto p-0"
      data-testid="esign-settings-link"
      onClick={() => void open()}
    >
      {t("process.admin.flow.esign.change")}
    </Button>
  );
}
