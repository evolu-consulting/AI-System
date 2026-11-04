// CR-118 · cr118-auth · `/community*` cần phiên `contracts` nhưng KHÔNG dội sang AI System (guard `bouncesToSso`); ngoài vùng
// `_authed` (không qua cổng gói contracts ⇒ đối tác vào được). Khung tạm: TODO(cr118-community-module) thay `component` bằng
// module community (lazy chunk) — giữ `beforeLoad`.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { logout } from "~/features/auth/api";
import { useSession } from "~/features/auth/hooks/use-session";
import { useSessionRedirect } from "~/features/auth/hooks/use-session-redirect";

function CommunityFrame() {
  const { t } = useTranslation();
  useSessionRedirect();
  const name = useSession((s) => s.me?.display_name);
  return (
    <main
      data-mod="community"
      className="grid min-h-dvh place-content-center gap-3 p-6 text-center"
    >
      <h1 className="text-2xl font-bold">{t("contracts.login.communityHome")}</h1>
      <p className="text-dim" data-testid="community-user">
        {name}
      </p>
      <button type="button" className="font-semibold text-act" onClick={() => void logout()}>
        {t("contracts.shell.logout")}
      </button>
    </main>
  );
}

export const Route = createFileRoute("/community")({
  beforeLoad: async ({ location }) =>
    (await import("~/features/auth/lib/guard")).requireSession(location),
  component: CommunityFrame,
});
