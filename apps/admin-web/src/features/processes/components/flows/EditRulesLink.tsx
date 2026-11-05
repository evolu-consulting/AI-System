// CR-120 · tenant_admin sửa LUẬT chọn quy trình ở Sổ Hợp Tác (Cài đặt › Ứng dụng & quy trình) — chuyển phiên bằng mã một lần
// như switcher; không có app (chưa bật / chưa có URL) ⇒ không hiện link.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useMyApps } from "@/features/agents/api";
import { openApp } from "@/features/shell/hooks/use-apps";

const SETTINGS_NEXT = "/contracts/settings?sec=apps";

export function EditRulesLink() {
  const { t } = useTranslation();
  const apps = useMyApps(true);
  const app = apps.data?.find((a) => a.key === "contracts" && a.url !== "");
  if (!app) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      data-testid="flows-edit-rules"
      onClick={() => void openApp(app, SETTINGS_NEXT, true)}
    >
      {t("process.admin.flows.editRules")}
    </Button>
  );
}
