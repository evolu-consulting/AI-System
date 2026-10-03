// CHAT-AC-21 · Dialog "Đổi tên hội thoại": 1–200 ký tự sau trim; lỗi → toast, giữ hộp để thử lại.
import { CHAT_TITLE_MAX } from "@ai/contracts/chat";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Ném lỗi nếu lưu hỏng (hộp vẫn mở). */
  onSave: (title: string) => Promise<void>;
};

export function RenameDialog({ open, onOpenChange, title, onSave }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= CHAT_TITLE_MAX;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } catch {
      // toast do container hiện; giữ hộp
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(title);
        onOpenChange(o);
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("rename.title")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-title">{t("rename.label")}</Label>
            <Input
              id="rename-title"
              value={value}
              maxLength={CHAT_TITLE_MAX}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("rename.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {t("rename.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
