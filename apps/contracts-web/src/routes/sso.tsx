// sso-switch · `/sso#code=…&next=…`: nhận mã một lần từ AI System ⇒ phiên contracts riêng (cookie `ai_rt_contracts`) ⇒
// `next` hoặc Tổng quan. Mã hỏng/hết hạn ⇒ form đăng nhập. Fragment xoá khỏi thanh địa chỉ ngay khi đọc.
import { parseSsoFragment } from "@ai/web-kit/auth/sso";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { safeNext } from "~/features/auth/lib/next";
import { redeemSso } from "~/features/auth/lib/sso";

function SsoLanding() {
  const { t } = useTranslation();
  const router = useRouter();
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const { code, next } = parseSsoFragment(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    const target = safeNext(next) ?? "/overview";
    const tenant = (import.meta.env.PUBLIC_TENANT_KEY ?? "").trim() || undefined;
    const go = async () => {
      if (!code) throw new Error("no code");
      await redeemSso(code, tenant);
      router.history.replace(target === "/" ? "/overview" : target);
    };
    go().catch(() => router.navigate({ to: "/login", search: { next: target }, replace: true }));
  }, [router]);
  return (
    <p role="status" className="grid h-dvh place-items-center text-body text-dim">
      {t("contracts.common.loading")}
    </p>
  );
}

export const Route = createFileRoute("/sso")({ component: SsoLanding });
