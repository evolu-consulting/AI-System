// app-catalog · nút "Ứng dụng" của Sổ Hợp Tác = switcher dùng chung (`@ai/web-kit/ui/AppSwitcher`): danh sách từ `GET /me/apps`
// (Admin quản lý, lọc theo vai + gói), chuyển phiên bằng mã một lần (`handOffUrl`). Env build chỉ là dự phòng khi API lỗi.
import { fallbackApps } from "@ai/web-kit/app-catalog/apps";
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { AppSwitcher as SharedAppSwitcher } from "@ai/web-kit/ui/AppSwitcher";
import { useTranslation } from "react-i18next";
import { session } from "~/features/auth/lib/session";
import { FALLBACK_URLS } from "../lib/fallback-urls";

export const CONTRACTS_APP_KEY = "contracts";

export function AppSwitcher({ role, userId }: { role: string | undefined; userId?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <SharedAppSwitcher
      current={CONTRACTS_APP_KEY}
      label={t("contracts.vgaps.apps.title")}
      locale={i18n.language}
      reloadKey={userId}
      fetchApps={() => session.myApps().then((r) => r.items)}
      fallback={() => fallbackApps(FALLBACK_URLS, role)}
      handOff={(a) =>
        handOffUrl({
          authed: true,
          grant: () => session.ssoGrant(a.key),
          fallbackBase: a.url,
          next: "/",
        })
      }
    />
  );
}
