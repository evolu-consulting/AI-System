// CR-169 · mục «Tin nhắn» ở thanh bên (kèm số chưa đọc) — chỉ khi người dùng có quyền Sổ Hợp Tác.
import { useUnreadTotal } from "@ai/messages-web/hooks/use-unread";
import { Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { useMessagesAccess } from "../hooks/use-messages-access";

function UnreadBadge() {
  const { t } = useTranslation();
  const n = useUnreadTotal();
  if (n <= 0) return null;
  return (
    <span
      data-testid="messages-unread"
      role="img"
      aria-label={t("contracts.messages.unread", { n })}
      className="tnum ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function MessagesNavLink({
  onNavigate,
  rail = false,
}: {
  onNavigate?: (() => void) | undefined;
  rail?: boolean;
}) {
  const { t } = useTranslation();
  const { allowed } = useMessagesAccess();
  if (!allowed) return null;
  return (
    <Link
      to="/messages"
      data-testid="nav-messages"
      aria-label={rail ? t("shell.messages") : undefined}
      title={rail ? t("shell.messages") : undefined}
      onClick={onNavigate}
      activeProps={{ "aria-current": "page", className: "bg-muted" }}
      className={cn(
        "flex items-center gap-2 rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        rail ? "size-10 justify-center" : "h-10 border border-input px-3 text-sm font-semibold",
      )}
    >
      <MessageSquare className="size-[18px] shrink-0" aria-hidden />
      {!rail && <span className="truncate">{t("shell.messages")}</span>}
      {!rail && <UnreadBadge />}
    </Link>
  );
}
