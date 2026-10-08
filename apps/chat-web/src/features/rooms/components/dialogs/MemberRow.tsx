// HUB-FR-97 · một dòng trong `dialog "Thành viên"`; chủ nhóm có menu `Tuỳ chọn của <tên>` cho người khác.
import type { RoomMember } from "@ai/contracts/chat";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

type Props = {
  member: RoomMember;
  isOwner: boolean;
  canManage: boolean;
  onAction: (kind: "transfer" | "remove") => void;
};

export function MemberRow({ member, isOwner, canManage, onAction }: Props) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{member.display_name}</span>
        <span className="truncate text-xs text-muted-foreground">@{member.username}</span>
      </span>
      {isOwner && (
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
          {t("rooms.owner")}
        </span>
      )}
      {canManage && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("rooms.memberOptions", { name: member.display_name })}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onAction("transfer")}>
              {t("rooms.transfer")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onAction("remove")}>
              {t("rooms.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
