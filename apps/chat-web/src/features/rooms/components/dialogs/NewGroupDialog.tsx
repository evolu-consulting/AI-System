// HUB-FR-96 · CHAT-AC-41 · `dialog "Tạo nhóm"`: tên (1–80) + chọn thành viên (≤ 49 người khác + chủ) → POST /rooms {kind:"group"} → /rooms/$id.
import { type DirectoryUser, ROOM_MEMBERS_MAX, ROOM_NAME_MAX } from "@ai/contracts/chat";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { PersonPicker } from "~/features/directory/components/PersonPicker";
import { useSession } from "~/lib/auth/use-session";
import { useCreateRoom } from "../../hooks/use-room-actions";
import { roomErrorKeyOf } from "../../lib/room-errors";
import { PickedChips } from "./PickedChips";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewGroupDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useSession((s) => s.me);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<DirectoryUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateRoom();
  const trimmed = name.trim();
  const full = picked.length + 1 >= ROOM_MEMBERS_MAX;
  const selectedIds = new Set(picked.map((u) => u.id));
  const selfIds = new Set(me ? [me.id] : []);

  const reset = () => {
    setName("");
    setPicked([]);
    setError(null);
  };
  const toggle = (u: DirectoryUser) =>
    setPicked((p) => (p.some((x) => x.id === u.id) ? p.filter((x) => x.id !== u.id) : [...p, u]));

  const submit = () => {
    if (!trimmed || create.isPending) return;
    setError(null);
    create.mutate(
      { kind: "group", name: trimmed, member_ids: picked.map((u) => u.id) },
      {
        onSuccess: (room) => {
          toast.success(t("rooms.toast.created", { name: room.name ?? trimmed }));
          onOpenChange(false);
          reset();
          void router.navigate({ to: "/rooms/$id", params: { id: room.id } });
        },
        onError: (err) => setError(t(roomErrorKeyOf(err))),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("rooms.newGroup.title")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-group-name">
              {t("rooms.newGroup.name")}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </Label>
            <Input
              id="new-group-name"
              value={name}
              maxLength={ROOM_NAME_MAX}
              aria-required="true"
              placeholder={t("rooms.newGroup.namePh")}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            {name.length > 0 && !trimmed && (
              <p role="alert" className="text-xs text-destructive">
                {t("rooms.name.empty")}
              </p>
            )}
          </div>
          <PickedChips
            selfName={me?.display_name ?? ""}
            picked={picked}
            full={full}
            onRemove={toggle}
          />
          <PersonPicker
            selectedIds={selectedIds}
            excludeIds={selfIds}
            full={full}
            onToggle={toggle}
            searchLabel={t("rooms.newGroup.search")}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("rooms.newGroup.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || create.isPending}>
              {create.isPending ? t("rooms.newGroup.creating") : t("rooms.newGroup.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
