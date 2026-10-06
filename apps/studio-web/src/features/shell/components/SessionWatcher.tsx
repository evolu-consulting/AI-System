// HUB-FR-72 · H4a-R14 · plan-frontend D5: refresh hỏng giữa phiên → xoá cache, về /login?next=<url hiện tại> + toast `session.expired`.
// H4a-R01 · mất quyền giữa phiên (API trả 403 FORBIDDEN; QueryClient đã xoá cache) → về /forbidden.
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { onForbidden } from "#/app/query-client";
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
  useEffect(
    () =>
      onForbidden(() => {
        if (router.state.location.pathname !== "/forbidden")
          void router.navigate({ to: "/forbidden", replace: true });
      }),
    [router],
  );
  return null;
}
