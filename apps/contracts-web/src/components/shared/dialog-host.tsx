// PK-FR-10 · TF2 · hộp thoại xác nhận/nhập bằng shadcn Dialog. Nguồn: reference/mgmt-app-contracts/web/src/components/dialog.tsx:28-82 (viết lại).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { type Req, registerHost } from "./dialog-bus";

/** Gắn một lần ở route gốc. Một yêu cầu hiện một lúc; yêu cầu mới huỷ cái đang mở. */
export function DialogHost() {
  const { t } = useTranslation();
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");
  const settled = useRef(false); // chặn resolve hai lần (đóng bằng code rồi onOpenChange)

  useEffect(
    () =>
      registerHost((r) => {
        setReq((prev) => {
          if (prev && !settled.current) prev.resolve(prev.kind === "prompt" ? null : false);
          return r;
        });
        setText(r.kind === "prompt" ? (r.initial ?? "") : "");
        settled.current = false;
      }),
    [],
  );

  if (!req) return null;

  const isPrompt = req.kind === "prompt";
  const finish = (value: boolean | string | null) => {
    if (settled.current) return;
    settled.current = true;
    req.resolve(value);
    setReq(null);
  };
  const cancel = () => finish(isPrompt ? null : false);
  const confirmOff = req.kind === "prompt" && req.required ? !text.trim() : false;

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent aria-label={req.title}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirmOff) finish(isPrompt ? text.trim() : true);
          }}
        >
          <DialogHeader>
            <DialogTitle>{req.title}</DialogTitle>
            <DialogDescription asChild>
              <div>{req.body}</div>
            </DialogDescription>
          </DialogHeader>
          {req.kind === "prompt" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="dialog-host-input">{req.label}</Label>
              <Input
                id="dialog-host-input"
                autoFocus
                value={text}
                placeholder={req.placeholder}
                maxLength={req.maxLength}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancel}>
              {req.cancelLabel ?? t("contracts.common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={confirmOff}
              variant={req.kind === "confirm" && req.danger ? "destructive" : "default"}
            >
              {req.confirmLabel ??
                (isPrompt ? t("contracts.common.save") : t("contracts.common.confirm"))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
