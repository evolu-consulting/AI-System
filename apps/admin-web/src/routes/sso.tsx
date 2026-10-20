// sso-switch · `/sso#code=…&next=…`: mã một lần từ AI System (app switcher của chat-web) ⇒ phiên admin riêng (cookie
// `ai_rt_admin`) ⇒ `next` hoặc trang chủ. Mã hỏng/hết hạn ⇒ form đăng nhập. Fragment xoá khỏi thanh địa chỉ ngay khi đọc.
import type { TokenGrant } from "@ai/contracts";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { safeNext } from "@/lib/auth/next";
import { session } from "@/lib/auth/session";
import { sendPublic } from "@/lib/http";

function SsoLanding() {
  const { t } = useTranslation();
  const router = useRouter();
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const code = frag.get("code");
    const next = frag.get("next");
    window.history.replaceState(null, "", window.location.pathname);
    const target = safeNext(next) ?? "/";
    const go = async () => {
      if (!code) throw new Error("no code");
      const grant = await sendPublic<TokenGrant>("/auth/sso/redeem", {
        method: "POST",
        body: { code },
      });
      session.applyGrant(grant);
      router.history.replace(target);
    };
    go().catch(() => router.navigate({ to: "/login", search: {}, replace: true }));
  }, [router]);
  return (
    <p role="status" className="grid h-dvh place-items-center text-sm text-muted-foreground">
      {t("common.loading")}
    </p>
  );
}

export const Route = createFileRoute("/sso")({ component: SsoLanding });
