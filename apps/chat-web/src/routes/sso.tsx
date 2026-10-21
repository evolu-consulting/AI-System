// sso-switch · `/sso?app=contracts|admin&next=/…`: AI System là nơi đăng nhập chung. Có phiên ⇒ xin mã một lần rồi chuyển
// sang `<app>/sso#code=…`; không phiên / lỗi ⇒ về form đăng nhập của app đích (`/login?sso=none`). URL đích chỉ lấy từ
// cấu hình build (`APP_URLS`), không từ query ⇒ không phải open redirect.
import { parseSsoFragment, ssoFallbackUrl, ssoLandingUrl } from "@ai/web-kit/auth/sso";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { APP_URLS, isSwitchApp, type SwitchApp } from "~/features/shell/lib/apps";
import { session } from "~/lib/auth/session";

type SsoSearch = { app?: SwitchApp; next?: string };

async function handOff(app: SwitchApp, next: string): Promise<string> {
  const base = APP_URLS[app];
  try {
    if ((await session.ensure()) !== "authed") return ssoFallbackUrl(base, next);
    return ssoLandingUrl(base, await session.ssoCode(app), next);
  } catch {
    return ssoFallbackUrl(base, next);
  }
}

function SsoPage() {
  const { t } = useTranslation();
  const { app, next } = Route.useSearch();
  useEffect(() => {
    // V2-GAPS: chiều ngược — contracts-web (app switcher) đưa mã một lần về AI System: `/sso#code=…&next=…` ⇒ phiên chat riêng.
    const { code, next: back } = parseSsoFragment(window.location.hash);
    if (code) {
      window.history.replaceState(null, "", window.location.pathname);
      const to = back === "/" ? "/c/new" : back;
      session
        .ssoRedeem(code)
        .then(() => window.location.replace(to))
        .catch(() => window.location.replace("/login"));
      return;
    }
    if (!app || !APP_URLS[app]) {
      window.location.replace("/c/new");
      return;
    }
    void handOff(app, next ?? "/").then((url) => window.location.replace(url));
  }, [app, next]);
  return (
    <p role="status" className="grid h-dvh place-items-center text-sm text-muted-foreground">
      {t("shell.appSwitching")}
    </p>
  );
}

export const Route = createFileRoute("/sso")({
  validateSearch: (search: Record<string, unknown>): SsoSearch => ({
    app: isSwitchApp(search.app) ? search.app : undefined,
    next: typeof search.next === "string" && search.next !== "" ? search.next : undefined,
  }),
  component: SsoPage,
});
