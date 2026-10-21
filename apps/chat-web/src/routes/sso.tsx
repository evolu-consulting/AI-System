// sso-switch · `/sso?app=<key>&next=/…`: AI System là nơi đăng nhập chung. Có phiên ⇒ xin mã một lần rồi chuyển sang
// `<target_url>/sso#code=…`; không phiên / lỗi ⇒ về form đăng nhập của app đích (`/login?sso=none`).
// app-catalog: URL đích do admin-api trả (`target_url`, từ catalog + đã kiểm quyền), không từ query/env ⇒ không phải open redirect.
// Env build chỉ là dự phòng cho nhánh quay về form đăng nhập khi API lỗi.
import { handOffUrl, parseSsoFragment } from "@ai/web-kit/auth/sso";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FALLBACK_URLS } from "~/features/shell/lib/fallback-urls";
import { session } from "~/lib/auth/session";

type SsoSearch = { app?: string; next?: string };
const APP_KEY = /^[a-z0-9-]{2,32}$/;

async function handOff(app: string, next: string): Promise<string | null> {
  const authed = (await session.ensure()) === "authed";
  return handOffUrl({
    authed,
    grant: () => session.ssoGrant(app),
    fallbackBase: FALLBACK_URLS[app],
    next,
  });
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
    if (!app) {
      window.location.replace("/c/new");
      return;
    }
    void handOff(app, next ?? "/").then((url) => window.location.replace(url ?? "/c/new"));
  }, [app, next]);
  return (
    <p role="status" className="grid h-dvh place-items-center text-sm text-muted-foreground">
      {t("shell.appSwitching")}
    </p>
  );
}

export const Route = createFileRoute("/sso")({
  validateSearch: (search: Record<string, unknown>): SsoSearch => ({
    app: typeof search.app === "string" && APP_KEY.test(search.app) ? search.app : undefined,
    next: typeof search.next === "string" && search.next !== "" ? search.next : undefined,
  }),
  component: SsoPage,
});
