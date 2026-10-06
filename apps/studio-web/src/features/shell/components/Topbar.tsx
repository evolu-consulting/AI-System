// HUB-FR-72 · topbar 60px: nút chuyển app "⇄ Admin". Badge `hub config vN` + menu Tài khoản thêm ở F2 (cần phiên).
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";

/** Admin cùng origin (reverse proxy) hoặc URL tuyệt đối qua `PUBLIC_ADMIN_URL`. */
const ADMIN_URL = import.meta.env.PUBLIC_ADMIN_URL || "/";

export function Topbar() {
  const { t } = useTranslation();
  return (
    <header className="flex h-topbar shrink-0 items-center justify-end gap-3 border-b border-border bg-card px-6">
      <Button asChild variant="outline" size="sm">
        <a href={ADMIN_URL}>{t("topbar.toAdmin")}</a>
      </Button>
    </header>
  );
}
