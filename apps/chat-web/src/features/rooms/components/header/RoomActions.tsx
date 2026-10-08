// HUB-FR-97, HUB-FR-98 · nút nhóm ở đầu phòng: `Thành viên (n)`, `Thêm người` (chỉ chủ), menu `Tuỳ chọn phòng`.
import { MoreVertical, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { RoomDialogKind } from "../dialogs/RoomDialogs";

type Props = { count: number; isOwner: boolean; onOpen: (kind: RoomDialogKind) => void };

export function RoomActions({ count, isOwner, onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("rooms.membersN", { count })}
        onClick={() => onOpen("members")}
      >
        <Users className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t("rooms.membersN", { count })}</span>
      </Button>
      {isOwner && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("rooms.addPeople")}
          onClick={() => onOpen("add")}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("rooms.addPeople")}</span>
        </Button>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={t("rooms.menu")}>
            <MoreVertical className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onOpen("members")}>
            {t("rooms.members")}
          </DropdownMenuItem>
          {isOwner && (
            <DropdownMenuItem onSelect={() => onOpen("rename")}>
              {t("rooms.rename")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onOpen("leave")}>{t("rooms.leave")}</DropdownMenuItem>
          {isOwner && (
            <DropdownMenuItem variant="destructive" onSelect={() => onOpen("delete")}>
              {t("rooms.delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
