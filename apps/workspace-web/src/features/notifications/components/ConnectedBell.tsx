// N3-FR-09 · CR-130 · MỘT chuông: dùng `NotificationBell` của web-kit (cùng chat/admin/studio); đây chỉ cấu hình riêng workspace — nhãn i18n,
// điều hướng bằng router (link có query `/community?post=<id>`, `/contracts/<id>`), chân "Xem tất cả/Cài đặt" chỉ khi có gói Sổ Hợp Tác.
import { NotificationBell } from "@ai/web-kit/ui/NotificationBell";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { useShellPacks } from "~/shell/use-shell-packs";

export function ConnectedBell() {
  const { t } = useTranslation();
  const router = useRouter();
  const packs = useShellPacks();
  return (
    <NotificationBell
      linkRows
      showFooter={packs.contracts === true}
      viewAllHref="/contracts/notifications"
      settingsHref="/contracts/notifications#prefs"
      onNavigate={(href) => void router.navigate({ href })}
      formatTime={viDate}
      labels={{
        bell: t("contracts.shell.notifications"),
        bellUnread: (n) => t("contracts.shell.notificationsUnread", { n }),
        title: t("contracts.shell.notifications"),
        empty: t("contracts.shell.notificationsEmpty"),
        readAll: t("contracts.shell.notificationsReadAll"),
        viewAll: t("contracts.shell.notificationsViewAll"),
        settings: t("contracts.shell.notificationsSettings"),
        unreadDot: t("contracts.shell.notificationUnreadDot"),
      }}
    />
  );
}
