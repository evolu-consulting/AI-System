// HUB-FR-97, HUB-FR-98 · CHAT-AC-42, 43 · `dialog "Thành viên"`: danh sách (tên, @username, "Chủ nhóm"); chủ có
// `button "Tuỳ chọn của <tên>"` → "Chuyển quyền chủ nhóm" / "Bớt khỏi nhóm" (đều qua `alertdialog` xác nhận).
import type { RoomDetail, RoomMember } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useRemoveRoomMember, useTransferRoom } from "../../hooks/use-room-actions";
import { roomErrorKeyOf } from "../../lib/room-errors";
import { roomToast } from "../../lib/room-toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { MemberRow } from "./MemberRow";

type Action = { kind: "transfer" | "remove"; member: RoomMember };
type Props = { room: RoomDetail; myId: string; onClose: () => void };

export function MembersDialog({ room, myId, onClose }: Props) {
  const { t } = useTranslation();
  const [action, setAction] = useState<Action | null>(null);
  const transfer = useTransferRoom(room.id);
  const remove = useRemoveRoomMember(room.id);
  const isOwner = room.owner_id === myId;

  // Đóng hộp xác nhận ngay khi bấm (kết quả tới qua toast + danh sách cập nhật); lỗi → toast lỗi.
  const confirm = () => {
    if (!action) return;
    const { kind, member } = action;
    setAction(null);
    const run =
      kind === "transfer" ? transfer.mutateAsync(member.id) : remove.mutateAsync(member.id);
    run.then(
      () =>
        roomToast(
          kind === "transfer"
            ? t("rooms.toast.transferred")
            : t("rooms.toast.removed", { name: member.display_name }),
        ),
      (err: unknown) => roomToast(t(roomErrorKeyOf(err))),
    );
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rooms.members")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("rooms.membersN", { count: room.members.length })}
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {room.members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isOwner={m.id === room.owner_id}
                canManage={isOwner && m.id !== myId}
                onAction={(kind) => setAction({ kind, member: m })}
              />
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      {action && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={t(`rooms.${action.kind}Dlg.title`)}
          body={t(`rooms.${action.kind}Dlg.body`, { name: action.member.display_name })}
          okLabel={t(`rooms.${action.kind}Dlg.ok`)}
          destructive={action.kind === "remove"}
          onConfirm={confirm}
        />
      )}
    </>
  );
}
