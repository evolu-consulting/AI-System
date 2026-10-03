// CHAT-AC-04 · chân sidebar: avatar chữ tắt + tên + username, nút Cài đặt.
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { initialsOf } from "../lib/conversation-path";

type Props = { displayName: string; username: string; onOpenSettings: () => void };

export function UserMenu({ displayName, username, onOpenSettings }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border p-2">
      <div
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[13px] font-semibold text-sidebar-accent-foreground"
      >
        {initialsOf(displayName)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{displayName}</span>
        <span className="truncate text-xs text-muted-foreground">{username}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("shell.settings")}
        onClick={onOpenSettings}
      >
        <Settings aria-hidden />
      </Button>
    </div>
  );
}
