// ADM-FR-04 · kết quả reset mật khẩu: khối mật khẩu tạm trong Dialog; đóng khi chưa sao chép thì hỏi lại.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TempPasswordPanel } from "@/components/shared/TempPasswordPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UncopiedConfirm } from "../drawer/UncopiedConfirm";

export type ResetResult = { tenantKey: string; username: string; password: string };

type Props = { result: ResetResult; onClose: () => void };

export function ResetPasswordDialog({ result, onClose }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const requestClose = () => (copied ? onClose() : setAsking(true));
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent showCloseButton={false} onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("users.reset.done", { username: result.username })}</DialogTitle>
            <DialogDescription>{t("tempPassword.body")}</DialogDescription>
          </DialogHeader>
          <TempPasswordPanel
            tenantKey={result.tenantKey}
            username={result.username}
            password={result.password}
            onCopied={() => setCopied(true)}
          />
          <p className="text-caption text-muted-foreground">{t("tempPassword.closeWarning")}</p>
          <DialogFooter>
            <Button onClick={requestClose}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <UncopiedConfirm open={asking} onOpenChange={setAsking} onClose={onClose} />
    </>
  );
}
