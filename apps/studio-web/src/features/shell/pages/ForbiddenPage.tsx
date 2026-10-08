// HUB-FR-72 · H4a-R01 · "Bạn không có quyền vào Agent Forge" (mẫu Admin `state.forbidden`): Về Chat (ẩn khi không cấu hình) + Đăng xuất.
import { ShieldX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { CHAT_URL } from "#/lib/env";
import { useLogout } from "../hooks/use-logout";

export function ForbiddenPage() {
  const { t } = useTranslation();
  const { logout, busy } = useLogout();
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center">
        <span className="text-card-title font-bold text-primary-strong">{t("app.name")}</span>
        <ShieldX aria-hidden className="size-10 text-destructive" />
        <h1 className="text-page-title font-bold text-foreground">{t("forbidden.title")}</h1>
        <p className="text-body text-muted-foreground">{t("forbidden.body")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {CHAT_URL ? (
            <Button asChild>
              <a href={CHAT_URL}>{t("forbidden.toChat")}</a>
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void logout()} disabled={busy}>
            {t("user.logout")}
          </Button>
        </div>
      </div>
    </main>
  );
}
