// HUB-FR-96, HUB-FR-98 · đầu phòng: tên (h1), phụ đề nhóm "Nhóm · n thành viên · chủ nhóm …"; DM có nút "Ẩn hội thoại".
// Nhóm: `RoomActions` (Thành viên, Thêm người, Tuỳ chọn phòng) mở dialog quản lý của F6.
import type { RoomDetail } from "@ai/contracts/chat";
import { EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { roomTitle } from "../../lib/room-logic";
import type { RoomDialogKind } from "../dialogs/RoomDialogs";
import { RoomActions } from "./RoomActions";

type Props = {
  room: RoomDetail | undefined;
  myId: string;
  onHide(): void;
  hiding: boolean;
  onOpen(kind: RoomDialogKind): void;
};

export function RoomHeader({ room, myId, onHide, hiding, onOpen }: Props) {
  const { t } = useTranslation();
  const owner = room?.members.find((m) => m.id === room.owner_id)?.display_name ?? "";
  return (
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      {room ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-card-title font-semibold">{roomTitle(room)}</h1>
          {room.kind === "group" && (
            <p className="truncate text-caption text-muted-foreground">
              {t("rooms.subtitleGroup", { count: room.member_count, owner })}
            </p>
          )}
        </div>
      ) : (
        <Skeleton className="h-6 w-48" />
      )}
      {room?.kind === "group" && (
        <RoomActions count={room.member_count} isOwner={room.owner_id === myId} onOpen={onOpen} />
      )}
      {room?.kind === "dm" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={hiding}
          aria-label={t("rooms.hide")}
          onClick={onHide}
        >
          <EyeOff className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("rooms.hide")}</span>
        </Button>
      )}
    </header>
  );
}
