// PK-FR-10 · TF5 · S16 chuông thông báo — khung rỗng ở N1 (danh sách và số chưa đọc nối ở HD4: truyền `unread` + `items`).
import { useTranslation } from "react-i18next";
import { IconBell } from "~/components/icons";
import { Popover } from "./Popover";

export function NotificationBell({ unread = 0 }: { unread?: number }) {
  const { t } = useTranslation();
  const label = unread
    ? t("contracts.shell.notificationsUnread", { n: unread })
    : t("contracts.shell.notifications");
  return (
    <Popover
      label={label}
      role="dialog"
      button={
        <span className="relative shrink-0">
          <IconBell />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-late px-1 text-micro font-semibold text-panel">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      }
    >
      {() => (
        <>
          <p className="border-b border-rule px-4 py-3 text-body font-semibold">
            {t("contracts.shell.notifications")}
          </p>
          <p className="px-4 py-8 text-center text-body text-dim">
            {t("contracts.shell.notificationsEmpty")}
          </p>
        </>
      )}
    </Popover>
  );
}
