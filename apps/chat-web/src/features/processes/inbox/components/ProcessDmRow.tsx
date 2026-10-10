// CHAT-AC-55 · FD6 · PF3: hàng DM "Quy trình" ghim đầu nhóm Users (`<li>`). Link `/process-inbox`, huy hiệu = `unread`.
// Tên accessible cố định "Quy trình" (aria-label) để không lẫn số huy hiệu; huy hiệu `aria-hidden` + `data-testid`.
import { Link } from "@tanstack/react-router";
import { Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInbox } from "../api";

export function ProcessDmRow() {
  const { t } = useTranslation();
  const q = useInbox();
  const unread = q.data?.pages[0]?.unread ?? 0;
  const name = t("process.common.sender.name");
  return (
    <li>
      <Link
        to="/process-inbox"
        aria-label={name}
        className="flex h-9 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted"
      >
        <Workflow className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {unread > 0 && (
          <span
            aria-hidden
            data-testid="process-dm-badge"
            title={t("process.inbox.dm.unread", { count: unread })}
            className="rounded-full bg-primary px-1.5 text-[11px] leading-4 font-semibold text-primary-foreground"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </li>
  );
}
