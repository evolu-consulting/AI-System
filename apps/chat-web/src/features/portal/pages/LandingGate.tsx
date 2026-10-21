// portal-home · `/`: landing = app khác ⇒ chuyển phiên sang đó (nháy "đang chuyển"), ngược lại hiện trang chủ.
import { entryNext, entryUrl } from "@ai/web-kit/app-catalog/apps";
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { session } from "~/lib/auth/session";
import { PortalPage } from "./PortalPage";

const indexRoute = getRouteApi("/");

export function LandingGate() {
  const { t } = useTranslation();
  const { landing } = indexRoute.useRouteContext();
  const target = landing.kind === "app" ? landing.app : null;
  useEffect(() => {
    if (!target) return;
    void handOffUrl({
      authed: true,
      grant: () => session.ssoGrant(target.key),
      fallbackBase: target.url,
      next: entryNext(target),
    })
      .catch(() => null)
      // Lỗi chuyển phiên ⇒ vẫn đưa tới app đích (nó tự về form đăng nhập), không kẹt ở màn chờ.
      .then((url) => window.location.replace(url ?? entryUrl(target)));
  }, [target]);
  if (target) {
    return (
      <p role="status" className="grid h-dvh place-items-center text-sm text-muted-foreground">
        {t("shell.appSwitching")}
      </p>
    );
  }
  return <PortalPage />;
}
