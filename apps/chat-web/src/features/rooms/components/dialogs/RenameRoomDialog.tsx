// HUB-FR-97 · `dialog "Đổi tên nhóm"`: `textbox "Tên nhóm"` (trim, 1–80) + `button "Lưu"`.
import { ROOM_NAME_MAX, type RoomDetail } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useRenameRoom } from "../../hooks/use-room-actions";
import { roomErrorKeyOf } from "../../lib/room-errors";
import { roomToast } from "../../lib/room-toast";

type Props = { room: RoomDetail; onClose: () => void };

export function RenameRoomDialog({ room, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(room.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const rename = useRenameRoom(room.id);
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed || rename.isPending) return;
    setError(null);
    rename.mutate(trimmed, {
      onSuccess: () => {
        roomToast(t("rooms.toast.renamed"));
        onClose();
      },
      onError: (err) => setError(t(roomErrorKeyOf(err))),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("rooms.renameDlg.title")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-room-name">{t("rooms.newGroup.name")}</Label>
            <Input
              id="rename-room-name"
              value={name}
              maxLength={ROOM_NAME_MAX}
              aria-required="true"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            {name.length > 0 && !trimmed && (
              <p role="alert" className="text-xs text-destructive">
                {t("rooms.name.empty")}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("rooms.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || rename.isPending}>
              {t("rooms.renameDlg.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
