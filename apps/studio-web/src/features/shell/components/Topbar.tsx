// HUB-FR-72 · topbar 60px: badge `hub config vN`, nút chuyển app "⇄ Admin" (ẩn khi vắng `PUBLIC_ADMIN_WEB_URL`), menu Tài khoản (chỉ khi có phiên).
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { useSession } from "#/lib/auth/use-session";
import { ADMIN_URL } from "#/lib/env";
import { ConfigBadge } from "./ConfigBadge";
import { UserMenu } from "./UserMenu";

export function Topbar() {
  const { t } = useTranslation();
  const authed = useSession((s) => s.status === "authed");
  return (
    <header className="flex h-topbar shrink-0 items-center justify-end gap-3 border-b border-border bg-card px-6">
      {authed ? <ConfigBadge /> : null}
      {ADMIN_URL ? (
        <Button asChild variant="outline" size="sm">
          <a href={ADMIN_URL}>{t("topbar.toAdmin")}</a>
        </Button>
      ) : null}
      {authed ? <UserMenu /> : null}
    </header>
  );
}
