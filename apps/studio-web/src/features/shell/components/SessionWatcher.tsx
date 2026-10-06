// HUB-FR-72 · H4a-R14 · plan-frontend D5: refresh hỏng giữa phiên → xoá cache, về /login?next=<url hiện tại> + toast `session.expired`.
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { safeNext } from "#/lib/auth/next";
import { session } from "#/lib/auth/session";

export function SessionWatcher() {
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTranslation();
  useEffect(
    () =>
      session.on("expired", () => {
        const next = safeNext(router.state.location.href);
        qc.clear();
        void router
          .navigate({ to: "/login", search: { next }, replace: true })
          .then(() => toast.error(t("session.expired")));
      }),
    [router, qc, t],
  );
  return null;
}
