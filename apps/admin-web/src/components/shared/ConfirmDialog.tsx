// ADM-FR-60, ADM-FR-04 · hộp thoại xác nhận (`alertdialog`): vừa (Huỷ/Xác nhận) hoặc nặng (gõ lại key mới bật nút).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** `heavy`: người dùng phải gõ lại `confirmText` (nhãn `typePrompt`). */
  level?: "medium" | "heavy";
  confirmText?: string;
  typePrompt?: string;
  /** Việc cần làm; hộp thoại đóng khi xong, giữ mở nếu ném lỗi (nơi gọi tự báo lỗi). */
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  level = "medium",
  confirmText,
  typePrompt,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const heavy = level === "heavy";

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const blocked = pending || (heavy && typed !== confirmText);

  const run = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // nơi gọi đã hiện toast lỗi; giữ hộp thoại để thử lại
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          // Mức nặng: focus vào ô gõ; mức vừa: Radix focus nút Huỷ (nút an toàn).
          if (heavy) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {heavy ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-type">{typePrompt}</Label>
            <Input
              id="confirm-type"
              ref={inputRef}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              className="font-mono"
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={blocked}
            onClick={run}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
