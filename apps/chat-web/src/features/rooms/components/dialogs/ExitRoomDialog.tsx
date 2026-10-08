// HUB-FR-98 · CHAT-AC-43 · xoá nhóm (chủ) / rời nhóm. Chủ còn người khác → "Chuyển quyền chủ nhóm trước khi rời";
// chủ một mình → rời = xoá. Thành công: toast + về `/c/new`; hành động của mình được đánh dấu để bỏ toast thừa.
import type { RoomDetail } from "@ai/contracts/chat";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRoomExit } from "../../hooks/use-room-actions";
import { roomErrorKeyOf } from "../../lib/room-errors";
import { roomToast } from "../../lib/room-toast";
import { markSelfExit, unmarkSelfExit } from "../../lib/self-exit";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  room: RoomDetail;
  kind: "delete" | "leave";
  isOwner: boolean;
  onClose: () => void;
  onOpenMembers: () => void;
};

type Copy = { title: string; body: string; ok: string };

function copyOf(kind: Props["kind"], alone: boolean): Copy {
  if (kind === "delete") {
    return {
      title: "rooms.deleteDlg.title",
      body: "rooms.deleteDlg.body",
      ok: "rooms.deleteDlg.ok",
    };
  }
  return {
    title: "rooms.leaveDlg.title",
    body: alone ? "rooms.leaveLast.body" : "rooms.leaveDlg.body",
    ok: alone ? "rooms.leaveLast.ok" : "rooms.leaveDlg.ok",
  };
}

export function ExitRoomDialog({ room, kind, isOwner, onClose, onOpenMembers }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const exit = useRoomExit(room.id, kind);
  const [error, setError] = useState<string | null>(null);
  const close = (open: boolean) => {
    if (!open) onClose();
  };

  if (kind === "leave" && isOwner && room.member_count > 1) {
    return (
      <ConfirmDialog
        open
        onOpenChange={close}
        title={t("rooms.mustTransfer.title")}
        body={t("rooms.mustTransfer.body")}
        okLabel={t("rooms.mustTransfer.open")}
        onConfirm={onOpenMembers}
      />
    );
  }

  const copy = copyOf(kind, kind === "leave" && isOwner);
  const confirm = () => {
    setError(null);
    markSelfExit(room.id);
    exit.mutate(undefined, {
      onSuccess: () => {
        roomToast(t(kind === "delete" ? "rooms.toast.deleted" : "rooms.toast.left"));
        onClose();
        void navigate({ to: "/c/new" });
      },
      onError: (err) => {
        unmarkSelfExit(room.id);
        setError(t(roomErrorKeyOf(err)));
      },
    });
  };
  return (
    <ConfirmDialog
      open
      onOpenChange={close}
      title={t(copy.title)}
      body={t(copy.body)}
      okLabel={t(copy.ok)}
      destructive
      pending={exit.isPending}
      error={error}
      onConfirm={confirm}
    />
  );
}
