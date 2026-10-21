// sso-switch · `/sso`: HAI chiều.
//  · `#code=…&next=…` — web ĐÍCH: nhận mã một lần từ AI System ⇒ phiên contracts riêng (cookie `ai_rt_contracts`) ⇒ `next` hoặc Tổng quan.
//    Mã hỏng/hết hạn ⇒ form đăng nhập. Fragment xoá khỏi thanh địa chỉ ngay khi đọc.
//  · `?app=chat|admin` — web NGUỒN (V2-GAPS, app switcher ngược): có phiên ⇒ xin mã một lần ⇒ `<app>/sso#code=…`; không phiên / lỗi ⇒
//    form đăng nhập của app đích. URL đích do admin-api trả (`target_url` từ catalog, đã kiểm quyền), không từ query/env ⇒ không phải open redirect.
import { handOffUrl, parseSsoFragment } from "@ai/web-kit/auth/sso";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { safeNext } from "~/features/auth/lib/next";
import { session } from "~/features/auth/lib/session";
import { redeemSso } from "~/features/auth/lib/sso";
import { FALLBACK_URLS } from "~/features/shell/lib/fallback-urls";

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

function SsoLanding() {
  const { t } = useTranslation();
  const router = useRouter();
  const { app, next: startNext } = Route.useSearch();
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const { code, next } = parseSsoFragment(window.location.hash);
    if (!code && app) {
      void handOff(app, startNext ?? "/").then((url) =>
        window.location.replace(url ?? "/overview"),
      );
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
    app: typeof search.app === "string" && APP_KEY.test(search.app) ? search.app : undefined,
    next: typeof search.next === "string" && search.next !== "" ? search.next : undefined,
  }),
  component: SsoLanding,
});
