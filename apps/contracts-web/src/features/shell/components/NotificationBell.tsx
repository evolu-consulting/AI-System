// PK-FR-10 · TF5 · N3-FR-09 · S16 chuông thông báo: khung trình bày thuần (không gọi API). Rỗng ⇒ đúng khung N1 (baseline khoá);
// có thông báo ⇒ danh sách, "đánh dấu tất cả", tùy chọn kênh. Dữ liệu do `features/notifications` truyền vào.
import type { Notification, NotifyPrefs } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { IconBell } from "~/components/icons";
import { NotificationItems } from "./NotificationItems";
import { NotifyPrefsForm } from "./NotifyPrefsForm";
import { Popover } from "./Popover";

export type NotificationBellProps = {
  unread?: number;
  items?: Notification[];
  prefs?: NotifyPrefs | null;
  /** Mở chuông ⇒ làm tươi danh sách. */
  onOpen?: () => void;
  onRead?: (id: string) => void;
  onReadAll?: () => void;
  onPrefs?: (p: NotifyPrefs) => void;
};

export function NotificationBell({
  unread = 0,
  items = [],
  prefs = null,
  onOpen,
  onRead,
  onReadAll,
  onPrefs,
}: NotificationBellProps) {
  const { t } = useTranslation();
  const label = unread
    ? t("contracts.shell.notificationsUnread", { n: unread })
    : t("contracts.shell.notifications");
  return (
    <Popover
      label={label}
      role="dialog"
      onToggle={(open) => open && onOpen?.()}
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
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <p className="text-body font-semibold">{t("contracts.shell.notifications")}</p>
            {unread > 0 && onReadAll && (
              <button
                type="button"
                onClick={onReadAll}
                className="text-micro font-medium text-act hover:underline"
              >
                {t("contracts.shell.notificationsReadAll")}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-body text-dim">
              {t("contracts.shell.notificationsEmpty")}
            </p>
          ) : (
            <NotificationItems items={items} onRead={onRead} />
          )}
          {items.length > 0 && prefs && onPrefs && (
            <NotifyPrefsForm prefs={prefs} onChange={onPrefs} />
          )}
        </>
      )}
    </Popover>
  );
}
