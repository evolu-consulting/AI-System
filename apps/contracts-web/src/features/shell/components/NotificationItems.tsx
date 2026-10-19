// N3-FR-09 · danh sách thông báo trong chuông: chưa đọc in đậm + chấm; bấm vào ⇒ đánh dấu đã đọc và đi tới liên kết (đường dẫn trong app).
import type { Notification } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { cn } from "~/lib/utils";

function Row({ n, onRead }: { n: Notification; onRead?: (id: string) => void }) {
  const { t } = useTranslation();
  const body = (
    <>
      <span className="flex items-start gap-2">
        {!n.read && (
          <span
            role="img"
            aria-label={t("contracts.shell.notificationUnreadDot")}
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-act"
          />
        )}
        <span className="min-w-0">
          <span className={cn("block truncate text-body", !n.read && "font-semibold")}>
            {n.title}
          </span>
          {n.body !== "" && (
            <span className="block text-micro text-dim line-clamp-2">{n.body}</span>
          )}
          <span className="block text-micro text-dim">{viDate(n.created_at)}</span>
        </span>
      </span>
    </>
  );
  const cls = "block w-full px-4 py-3 text-left hover:bg-sunk";
  const click = () => {
    if (!n.read) onRead?.(n.id);
  };
  // `link` do server kiểm: bắt đầu `/`, không `//` ⇒ chỉ điều hướng trong app.
  return n.link ? (
    <Link to={n.link as "/"} onClick={click} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={click} className={cls}>
      {body}
    </button>
  );
}

export function NotificationItems({
  items,
  onRead,
}: {
  items: Notification[];
  onRead?: (id: string) => void;
}) {
  return (
    <ul className="max-h-[360px] divide-y divide-rule overflow-y-auto">
      {items.map((n) => (
        <li key={n.id}>
          <Row n={n} onRead={onRead} />
        </li>
      ))}
    </ul>
  );
}
