// HUB-FR-97 · CHAT-AC-42 · `dialog "Thêm người vào nhóm"` (chỉ chủ). Người đã trong nhóm: checkbox `disabled` + "Đã trong nhóm".
// Chọn quá 50 người vẫn gửi được: server trả `ROOM_FULL` → `alert` "Nhóm đã đủ 50 người" (plan.md §16, F6).
import { type DirectoryUser, ROOM_MEMBERS_MAX, type RoomDetail } from "@ai/contracts/chat";
import { X } from "lucide-react";
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
import { PersonPicker } from "~/features/directory/components/PersonPicker";
import { useAddRoomMembers } from "../../hooks/use-room-actions";
import { roomErrorKeyOf } from "../../lib/room-errors";
import { roomToast } from "../../lib/room-toast";

type Props = { room: RoomDetail; onClose: () => void };

export function AddMembersDialog({ room, onClose }: Props) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<DirectoryUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = useAddRoomMembers(room.id);
  const total = room.members.length + picked.length;
  const toggle = (u: DirectoryUser) =>
    setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));

  const submit = () => {
    if (picked.length === 0 || add.isPending) return;
    setError(null);
    add.mutate(
      picked.map((u) => u.id),
      {
        onSuccess: () => {
          roomToast(t("rooms.toast.added", { count: picked.length }));
          onClose();
        },
        onError: (err) => setError(t(roomErrorKeyOf(err))),
      },
    );
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
            <DialogTitle>{t("rooms.add.title")}</DialogTitle>
          </DialogHeader>
          {picked.length > 0 && (
            <ul aria-label={t("rooms.newGroup.picked")} className="flex flex-wrap gap-1.5">
              {picked.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-1 text-xs font-medium"
                >
                  {u.display_name}
                  <button
                    type="button"
                    aria-label={t("rooms.newGroup.remove", { name: u.display_name })}
                    onClick={() => toggle(u)}
                    className="rounded-full p-0.5 outline-none hover:bg-border focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <PersonPicker
            selectedIds={new Set(picked.map((u) => u.id))}
            already={room.members}
            alreadyLabel={t("rooms.add.already")}
            full={false}
            onToggle={toggle}
            searchLabel={t("rooms.newGroup.search")}
          />
          <p role="status" className="text-xs text-muted-foreground">
            {t("rooms.newGroup.count", { n: total })}
            {total >= ROOM_MEMBERS_MAX && ` · ${t("rooms.newGroup.full")}`}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("rooms.cancel")}
            </Button>
            <Button type="submit" disabled={picked.length === 0 || add.isPending}>
              {add.isPending ? t("rooms.add.adding") : t("rooms.add.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
