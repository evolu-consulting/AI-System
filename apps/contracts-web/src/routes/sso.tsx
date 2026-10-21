// sso-switch · `/sso`: HAI chiều.
//  · `#code=…&next=…` — web ĐÍCH: nhận mã một lần từ AI System ⇒ phiên contracts riêng (cookie `ai_rt_contracts`) ⇒ `next` hoặc Tổng quan.
//    Mã hỏng/hết hạn ⇒ form đăng nhập. Fragment xoá khỏi thanh địa chỉ ngay khi đọc.
//  · `?app=chat|admin` — web NGUỒN (V2-GAPS, app switcher ngược): có phiên ⇒ xin mã một lần ⇒ `<app>/sso#code=…`; không phiên / lỗi ⇒
//    form đăng nhập của app đích. URL đích chỉ từ cấu hình build (`APP_URLS`), không từ query ⇒ không phải open redirect.
import { parseSsoFragment, ssoFallbackUrl, ssoLandingUrl } from "@ai/web-kit/auth/sso";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { safeNext } from "~/features/auth/lib/next";
import { session } from "~/features/auth/lib/session";
import { redeemSso } from "~/features/auth/lib/sso";
import { APP_URLS, isSwitchApp, type SwitchApp } from "~/features/shell/lib/apps";

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

function SsoLanding() {
  const { t } = useTranslation();
  const router = useRouter();
  const { app, next: startNext } = Route.useSearch();
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const { code, next } = parseSsoFragment(window.location.hash);
    if (!code && app && APP_URLS[app]) {
      void handOff(app, startNext ?? "/").then((url) => window.location.replace(url));
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    const target = safeNext(next) ?? "/overview";
    const tenant = (import.meta.env.PUBLIC_TENANT_KEY ?? "").trim() || undefined;
    const go = async () => {
      if (!code) throw new Error("no code");
      await redeemSso(code, tenant);
      router.history.replace(target === "/" ? "/overview" : target);
    };
    go().catch(() => router.navigate({ to: "/login", search: { next: target }, replace: true }));
  }, [router, app, startNext]);
  return (
    <p role="status" className="grid h-dvh place-items-center text-body text-dim">
      {t("contracts.common.loading")}
    </p>
  );
}

export const Route = createFileRoute("/sso")({
  validateSearch: (search: Record<string, unknown>): SsoSearch => ({
    app: isSwitchApp(search.app) ? search.app : undefined,
    next: typeof search.next === "string" && search.next !== "" ? search.next : undefined,
  }),
  component: SsoLanding,
});
