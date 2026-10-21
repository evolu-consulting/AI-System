// app-catalog · nút "Ứng dụng" của AI System = switcher dùng chung (`@ai/web-kit/ui/AppSwitcher`): danh sách từ `GET /me/apps`
// (Admin quản lý, lọc theo vai + gói), chuyển phiên bằng mã một lần (`handOffUrl`). Env build chỉ là dự phòng khi API lỗi.
import { fallbackApps } from "@ai/web-kit/app-catalog/apps";
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { AppSwitcher as SharedAppSwitcher } from "@ai/web-kit/ui/AppSwitcher";
import { useTranslation } from "react-i18next";
import { session } from "~/lib/auth/session";
import { useSession } from "~/lib/auth/use-session";
import { FALLBACK_URLS } from "../lib/fallback-urls";

export const CHAT_APP_KEY = "chat";

export function AppSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const me = useSession((s) => s.me);
  return (
    <span className={className}>
      <SharedAppSwitcher
        current={CHAT_APP_KEY}
        label={t("shell.apps")}
        locale={i18n.language}
        reloadKey={me?.id}
        fetchApps={() => session.myApps().then((r) => r.items)}
        fallback={() => fallbackApps(FALLBACK_URLS, me?.role)}
        handOff={(a) =>
          handOffUrl({
            authed: true,
            grant: () => session.ssoGrant(a.key),
            fallbackBase: a.url,
            next: "/",
          })
        }
      />
    </span>
  );
}
