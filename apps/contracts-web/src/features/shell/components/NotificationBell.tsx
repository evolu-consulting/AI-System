// PK-FR-10 · TF5 · N3-FR-09 · S16 chuông thông báo: khung trình bày thuần (không gọi API). Rỗng ⇒ đúng khung N1 (baseline khoá);
// có thông báo ⇒ danh sách, "đánh dấu tất cả"; chân luôn có "Xem tất cả" + "Cài đặt thông báo" (trang /notifications). Dữ liệu do `features/notifications` truyền vào.
import type { Notification } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconBell } from "~/components/icons";
import { NotificationItems } from "./NotificationItems";
import { Popover } from "./Popover";

export type NotificationBellProps = {
  unread?: number;
  items?: Notification[];
  /** Mở chuông ⇒ làm tươi danh sách. */
  onOpen?: () => void;
  onRead?: (id: string) => void;
  onReadAll?: () => void;
};

export function NotificationBell({
  unread = 0,
  items = [],
  onOpen,
  onRead,
  onReadAll,
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
          {/* gap-c #13: chân luôn có — danh sách đầy đủ + form tùy chọn (kể cả khi chưa có thông báo). */}
          <div className="flex items-center justify-between border-t border-rule px-4 py-3 text-micro font-medium">
            <Link to="/notifications" className="text-act hover:underline">
              {t("contracts.shell.notificationsViewAll")}
            </Link>
            <Link to="/notifications" hash="prefs" className="text-act hover:underline">
              {t("contracts.shell.notificationsSettings")}
            </Link>
          </div>
        </>
      )}
    </Popover>
  );
}
