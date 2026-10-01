// ADM-FR-20 · menu `⋯` của một command: Sửa · Nhân bản · Bật/Tắt · Xoá (không có Lịch sử: M4, không có Chạy thử: FR-23 là M5).
import type { CommandListItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  command: CommandListItem;
  onToggle: (c: CommandListItem, enabled: boolean) => void;
  onDelete: (c: CommandListItem) => void;
};

export function CommandRowMenu({ command, onToggle, onDelete }: Props) {
  const { t } = useTranslation();
  const lockedOn = !command.enabled && !command.workflow.enabled;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/commands/$commandId" params={{ commandId: command.id }}>
            {t("commands.list.menu.edit")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/commands/new" search={{ from: command.id }}>
            {t("commands.list.menu.duplicate")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={lockedOn} onSelect={() => onToggle(command, !command.enabled)}>
          {t(command.enabled ? "common.off" : "common.on")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDelete(command)}>
          {t("commands.list.menu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
