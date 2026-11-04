// PK-FR-10 · TF4 · trong vùng `_authed`: refresh hỏng giữa chừng ⇒ toast "Phiên đã hết hạn" + `/login?next=<trang hiện tại>`;
// đăng xuất (tab này, tab khác, hoặc `/me` 401) ⇒ `/login?next=` (đăng nhập lại quay về đúng trang).
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "~/components/shared/toast";
import { session } from "../lib/session";

export function useSessionRedirect(): void {
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    const toLogin = () =>
      void router.navigate({
        to: "/login",
        search: { next: router.state.location.href },
        replace: true,
      });
    const offExpired = session.on("expired", () => {
      toast(t("contracts.session.expired"), "late");
      toLogin();
    });
    const offCleared = session.on("cleared", toLogin);
    return () => {
      offExpired();
      offCleared();
    };
  }, [router, t]);
}
