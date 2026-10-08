// CR-050 · nút `⋯` trên dòng phòng ở sidebar. Nhóm: Đổi tên (chủ) · Rời nhóm (không phải chủ, hoặc chủ một mình) ·
// Xoá nhóm (chủ). Chủ còn người khác muốn rời → chuyển quyền trong phòng (menu đầu phòng). DM: Ẩn hội thoại (DM dùng
// chung với người kia nên không xoá hẳn; tin mới làm nó hiện lại — R07).
import type { RoomSummary } from "@ai/contracts/chat";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useRoomExit } from "../hooks/use-room-actions";
import { roomTitle } from "../lib/room-logic";
import { roomToast } from "../lib/room-toast";

const RenameRoomDialog = lazy(() =>
  import("./dialogs/RenameRoomDialog").then((m) => ({ default: m.RenameRoomDialog })),
);
const ExitRoomDialog = lazy(() =>
  import("./dialogs/ExitRoomDialog").then((m) => ({ default: m.ExitRoomDialog })),
);

type Dialog = "rename" | "leave" | "delete";
type Props = { room: RoomSummary; active: boolean };

export function RoomRowMenu({ room, active }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const hide = useRoomExit(room.id, "hide");
  const owner = room.my_role === "owner";
  const group = room.kind === "group";
  const close = () => setDialog(null);
  const onHide = () =>
    hide.mutate(undefined, {
      onSuccess: () => {
        roomToast(t("rooms.toast.hidden"));
        if (active) void navigate({ to: "/c/new" });
      },
      onError: () => toast.error(t("rooms.toast.actionFailed")),
    });

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("rooms.rowMenu", { name: roomTitle(room) })}
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2 bg-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {group && owner && (
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              {t("item.rename")}
            </DropdownMenuItem>
          )}
          {group && (!owner || room.member_count === 1) && (
            <DropdownMenuItem onSelect={() => setDialog("leave")}>
              {t("rooms.leave")}
            </DropdownMenuItem>
          )}
          {group && owner && (
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
              {t("rooms.delete")}
            </DropdownMenuItem>
          )}
          {!group && (
            <DropdownMenuItem disabled={hide.isPending} onSelect={onHide}>
              {t("rooms.hide")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog && (
        <Suspense fallback={null}>
          {dialog === "rename" ? (
            <RenameRoomDialog room={room} onClose={close} />
          ) : (
            <ExitRoomDialog
              room={room}
              kind={dialog}
              isOwner={owner}
              stay={!active}
              onClose={close}
              onOpenMembers={() => {
                close();
                void navigate({ to: "/rooms/$id", params: { id: room.id } });
              }}
            />
          )}
        </Suspense>
      )}
    </>
  );
}
