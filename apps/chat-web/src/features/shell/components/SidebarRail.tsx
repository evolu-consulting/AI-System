// Polish UI · sidebar thu gọn (rail 64px, desktop): nút mở rộng, Hỏi AI mới, phòng + hội thoại dạng avatar chữ tắt;
// mỗi mục có tooltip tên khi rê chuột/focus.
import { Link, useRouter } from "@tanstack/react-router";
import { PanelLeftOpen, Plus, Settings } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { useConversationList } from "~/features/conversations/hooks/use-conversations";
import { useRoomList } from "~/features/rooms/hooks/use-room-list";
import { roomTitle } from "~/features/rooms/lib/room-logic";
import { cn } from "~/lib/utils";
import { initialsOf } from "../lib/conversation-path";

type Props = {
  activeId: string | null;
  activeRoomId: string | null;
  onExpand: () => void;
  onOpenSettings: () => void;
};

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function Avatar(p: { label: string; active: boolean; unread?: number; children?: ReactNode }) {
  return (
    <span
      className={cn(
        "relative flex size-9 items-center justify-center rounded-full text-xs font-semibold",
        p.active
          ? "bg-sidebar-accent text-sidebar-accent-foreground ring-2 ring-ring/40"
          : "bg-accent text-accent-foreground",
      )}
    >
      {initialsOf(p.label)}
      {(p.unread ?? 0) > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card"
        />
      )}
      {p.children}
    </span>
  );
}

const linkCls =
  "flex size-10 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

export function SidebarRail(p: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const rooms = useRoomList();
  const convs = useConversationList("");
  return (
    <TooltipProvider delayDuration={150}>
      <nav
        aria-label={t("shell.nav")}
        className="flex h-full w-16 shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-card py-4"
      >
        <Tip label={t("shell.expandSidebar")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("shell.expandSidebar")}
            onClick={p.onExpand}
          >
            <PanelLeftOpen aria-hidden />
          </Button>
        </Tip>
        <Tip label={t("shell.newChat")}>
          <Link
            to="/c/new"
            aria-label={t("shell.newChat")}
            className="flex size-10 items-center justify-center rounded-lg border border-input outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-[18px]" aria-hidden />
          </Link>
        </Tip>
        <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto py-1">
          {rooms.items.map((r) => {
            const title = roomTitle(r);
            const active = r.id === p.activeRoomId;
            return (
              <li key={r.id}>
                <Tip label={title}>
                  <a
                    href={`/rooms/${encodeURIComponent(r.id)}`}
                    aria-label={title}
                    aria-current={active ? "page" : undefined}
                    className={linkCls}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      void router.navigate({ to: "/rooms/$id", params: { id: r.id } });
                    }}
                  >
                    <Avatar label={title} active={active} unread={r.unread} />
                  </a>
                </Tip>
              </li>
            );
          })}
          {convs.items.map((c) => {
            const active = c.id === p.activeId;
            return (
              <li key={c.id}>
                <Tip label={c.title}>
                  <a
                    href={`/c/${encodeURIComponent(c.id)}`}
                    aria-label={c.title}
                    aria-current={active ? "page" : undefined}
                    className={linkCls}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      void router.navigate({ to: "/c/$id", params: { id: c.id } });
                    }}
                  >
                    <Avatar label={c.title} active={active} />
                  </a>
                </Tip>
              </li>
            );
          })}
        </ul>
        <Tip label={t("shell.settings")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("shell.settings")}
            onClick={p.onOpenSettings}
          >
            <Settings aria-hidden />
          </Button>
        </Tip>
      </nav>
    </TooltipProvider>
  );
}
