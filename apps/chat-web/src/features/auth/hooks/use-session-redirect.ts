// CHAT-AC-03, CHAT-AC-04 · trong vùng `_authed`: refresh hỏng → `/login?next=<trang hiện tại>` + toast "Phiên đã hết hạn";
// đăng xuất (tab này hoặc tab khác) → `/login`.
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { session } from "~/lib/auth/session";

export function useSessionRedirect(): void {
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    const offExpired = session.on("expired", () => {
      const msg = t("session.expired");
      void import("@ai/web-kit/ui/toast").then(({ toast }) => toast.error(msg)); // CR-118 bundle: tải lười
      void router.navigate({
        to: "/login",
        search: { next: router.state.location.href },
        replace: true,
      });
    });
    const offCleared = session.on("cleared", () => {
      void router.navigate({ to: "/login", search: {}, replace: true });
    });
    return () => {
      offExpired();
      offCleared();
    };
  }, [router, t]);
}
