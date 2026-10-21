// HUB-FR-72 · topbar 60px dùng khung chung `TopShell` (web-kit): badge `hub config vN`, switcher "Ứng dụng" dùng chung (danh sách từ
// `GET /auth/me/apps`, Admin quản lý), menu Tài khoản (chỉ khi có phiên).
import { fallbackApps } from "@ai/web-kit/app-catalog/apps";
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { AppSwitcher } from "@ai/web-kit/ui/AppSwitcher";
import { TopShell } from "@ai/web-kit/ui/TopShell";
import { useTranslation } from "react-i18next";
import { FALLBACK_URLS } from "#/lib/apps";
import { session } from "#/lib/auth/session";
import { useSession } from "#/lib/auth/use-session";
import { fetchMyApps, requestSsoGrant } from "../hooks/use-apps";
import { ConfigBadge } from "./ConfigBadge";
import { UserMenu } from "./UserMenu";

const STUDIO_APP_KEY = "studio";

function Apps() {
  const { t, i18n } = useTranslation();
  const me = useSession((s) => s.user);
  return (
    <AppSwitcher
      current={STUDIO_APP_KEY}
      label={t("topbar.apps")}
      locale={i18n.language}
      reloadKey={me?.id}
      fetchApps={fetchMyApps}
      fallback={() => fallbackApps(FALLBACK_URLS, me?.role)}
      handOff={(a) =>
        handOffUrl({
          authed: session.getState().status === "authed",
          grant: () => requestSsoGrant(a.key),
          fallbackBase: a.url,
          next: "/",
        })
      }
    />
  );
}

export function Topbar() {
  const authed = useSession((s) => s.status === "authed");
  return (
    <TopShell apps={authed ? <Apps /> : null} end={authed ? <UserMenu /> : null}>
      {authed ? <ConfigBadge /> : null}
    </TopShell>
  );
}
