// CHAT-AC-57 · HUB-FR-111 · plan-frontend §4: hộp chọn người nhận (PersonPicker chọn 1) + lời nhắn. Lười (chỉ nạp khi mở).
import type { DirectoryUser } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { PersonPicker } from "~/features/directory/components/PersonPicker";
import { useSession } from "~/lib/auth/use-session";
import { codeOf, isClosedError, useForwardTask } from "../hooks/use-ask-actions";
import { askErrorKey, FORWARD_CHAIN_MAX, FORWARD_NOTE_MAX, validateNote } from "../lib/ask-rules";
import type { ForwardActionProps } from "../lib/forward-props";

export type ForwardDialogProps = ForwardActionProps & {
  open: boolean;
  onOpenChange(open: boolean): void;
};

export function ForwardDialog(p: ForwardDialogProps) {
  const { t } = useTranslation();
  const myId = useSession((s) => s.me?.id ?? "");
  const [picked, setPicked] = useState<DirectoryUser | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fwd = useForwardTask(p.taskId);
  const isAsk = p.kind === "ask";
  const exclude = new Set([myId, ...(p.excludeIds ?? [])]);

  const submit = () => {
    if (!picked || fwd.isPending) return;
    if (validateNote(note)) {
      setError(t("process.common.validate.tooLong", { max: FORWARD_NOTE_MAX }));
      return;
    }
    setError(null);
    const trimmed = note.trim();
    fwd.mutate(
      { to_user_id: picked.id, ...(trimmed && { note: trimmed }) },
      {
        onSuccess: () => {
          toast(
            <span role="status">
              {t("process.ask.toast.forwarded", { to: picked.display_name })}
            </span>,
          );
          p.onForwarded?.();
          p.onOpenChange(false);
        },
        onError: (e) => {
          setError(t(askErrorKey(codeOf(e)), { max: FORWARD_CHAIN_MAX }));
          if (isClosedError(e)) p.onForwarded?.();
        },
      },
    );
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(isAsk ? "process.ask.forwardTitle" : "process.ask.forwardTitleReview")}
            </DialogTitle>
            <DialogDescription>
              {t(isAsk ? "process.ask.forwardHelp" : "process.ask.forwardHelpReview")}
            </DialogDescription>
          </DialogHeader>
          <PersonPicker
            selectedIds={new Set(picked ? [picked.id] : [])}
            excludeIds={exclude}
            full={picked !== null}
            onToggle={(u) => setPicked((c) => (c?.id === u.id ? null : u))}
            searchLabel={t("process.ask.search")}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`fwd-note-${p.taskId}`}>{t("process.ask.note")}</Label>
            <Textarea
              id={`fwd-note-${p.taskId}`}
              value={note}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => p.onOpenChange(false)}>
              {t("process.ask.cancel")}
            </Button>
            <Button type="submit" disabled={!picked || fwd.isPending}>
              {t(isAsk ? "process.ask.submit" : "process.ask.submitReview")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
