// CR-132 · W3 · chấm đỏ + số chưa đọc dùng chung (nút mở khoang, tab «Tin nhắn», thanh dưới điện thoại). 0 ⇒ không hiện; trên 99 ⇒ «99+».
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { unreadLabel } from "../lib/conversations";

export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  const text = unreadLabel(count);
  if (!text) return null;
  return (
    <span
      data-testid="unread-badge"
      role="img"
      aria-label={t("contracts.messages.unread", { n: count })}
      className={cn(
        "tnum grid h-4 min-w-4 place-items-center rounded-full bg-late px-1 text-micro font-semibold text-panel",
        className,
      )}
    >
      {text}
    </span>
  );
}
