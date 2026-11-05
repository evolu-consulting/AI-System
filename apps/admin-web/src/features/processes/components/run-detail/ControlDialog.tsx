// CR-121 · R-3: thẻ xác nhận thao tác điều khiển lượt chạy — nói hậu quả + chọn lý do bắt buộc (chip) ⇒ gọi API.
import type { RunControlReason } from "@ai/contracts/chat";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CONTROL_REASONS } from "../../lib/run-detail-view";

export type ControlTarget =
  | { op: "stop" }
  | { op: "rerun" }
  | { op: "reopen"; contractId: string }
  | { op: "rerun-step"; idx: number; name: string };

type Props = {
  target: ControlTarget | null;
  pending: boolean;
  /** Câu lỗi dễ hiểu của lần gọi trước (hiện trong thẻ, không đóng thẻ). */
  error: string | null;
  onCancel: () => void;
  /** Lý do tự nhập (bắt buộc, ≤ 500 ký tự) thay cho chip — platform_admin mở lại thay công ty. Gửi kèm `text` đã cắt khoảng trắng. */
  freeReason?: boolean;
  onConfirm: (reason: RunControlReason, text?: string) => void;
};

export const FREE_REASON_MAX = 500;
/** Lý do tự nhập hợp lệ: sau trim 1..500 ký tự (code point, khớp luật server). */
export const freeReasonOk = (s: string): boolean => {
  const n = Array.from(s.trim()).length;
  return n >= 1 && n <= FREE_REASON_MAX;
};

export function ControlDialog({
  target,
  pending,
  error,
  freeReason = false,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<RunControlReason | null>(null);
  const [text, setText] = useState("");
  const op = target?.op ?? "stop";
  // Mỗi lần mở thẻ mới ⇒ chọn lại lý do (không mang lý do cũ sang thao tác khác).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ đặt lại khi đổi mục tiêu
  useEffect(() => {
    setReason(null);
    setText("");
  }, [target?.op, target && "idx" in target ? target.idx : -1]);
  const free = freeReason && op === "reopen";
  const ready = free ? freeReasonOk(text) : reason !== null;
  const name = target && "name" in target ? target.name : "";
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`process.admin.runDetail.ctl.${op}.title`, { name })}</DialogTitle>
          <DialogDescription>
            {t(`process.admin.runDetail.ctl.${op}.effect`, { name })}
          </DialogDescription>
        </DialogHeader>
        {free && (
          <div className="space-y-1">
            <label htmlFor="control-free-reason" className="text-label font-semibold">
              {t("process.admin.runDetail.ctl.reopen.platformReasonLabel")}
            </label>
            <Textarea
              id="control-free-reason"
              data-testid="run-reopen-reason"
              value={text}
              rows={3}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={Array.from(text.trim()).length > FREE_REASON_MAX}
            />
            <p className="text-caption text-muted-foreground">
              {t("process.admin.runDetail.ctl.reopen.platformReasonHint")}{" "}
              {t("process.admin.runDetail.ctl.reopen.platformReasonCount", {
                n: Array.from(text.trim()).length,
              })}
            </p>
          </div>
        )}
        <div
          hidden={free}
          role="radiogroup"
          aria-label={t("process.admin.runDetail.ctl.reasonLabel")}
          className="flex flex-wrap gap-2"
        >
          {CONTROL_REASONS.map((r) => (
            // biome-ignore lint/a11y/useSemanticElements: chip lý do dạng radio tuỳ biến (nhóm radiogroup)
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                "rounded-full border px-3 py-1 text-body transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                reason === r
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {t(`process.admin.runDetail.ctl.reason.${r}`)}
            </button>
          ))}
        </div>
        {!free && reason === null && (
          <p className="text-caption text-muted-foreground">
            {t("process.admin.runDetail.ctl.reasonHint")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {t("process.admin.runDetail.ctl.cancel")}
          </Button>
          <Button
            variant={op === "stop" ? "destructive" : "default"}
            disabled={!ready || pending}
            data-testid="control-confirm"
            onClick={() => {
              if (free) onConfirm("other", text.trim());
              else if (reason) onConfirm(reason);
            }}
          >
            {t(`process.admin.runDetail.ctl.${op}.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
