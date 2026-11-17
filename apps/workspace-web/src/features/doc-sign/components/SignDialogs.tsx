// CR-181 · s12 · hộp xác nhận «Lưu chữ ký?» + hộp danh sách kiểm tra chỗ ký (readiness).
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ai/web-kit/ui/kit/alert-dialog";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import { useTranslation } from "react-i18next";
import type { readinessLines, signSummary } from "../lib/session-map";

export function ConfirmSignDialog(p: {
  summary: ReturnType<typeof signSummary> | null;
  busy: boolean;
  onOk: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={!!p.summary} onOpenChange={(o) => !o && p.onCancel()}>
      <AlertDialogContent data-testid="sign-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("contracts.docsign.confirm.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("contracts.docsign.confirm.body", p.summary ?? {})}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">{t("contracts.docsign.confirm.cancel")}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button disabled={p.busy} onClick={p.onOk}>
              {t("contracts.docsign.confirm.ok")}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ReadinessDialog(p: {
  lines: ReturnType<typeof readinessLines> | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lines = p.lines ?? [];
  return (
    <Dialog open={!!p.lines} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent data-testid="sign-readiness" closeLabel={t("contracts.docsign.close")}>
        <DialogHeader>
          <DialogTitle>
            {t(lines.length ? "contracts.docsign.ready.title" : "contracts.docsign.ready.done")}
          </DialogTitle>
        </DialogHeader>
        {lines.length > 0 && (
          <DialogBody>
            <p className="text-sm">{t("contracts.docsign.ready.body")}</p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {lines.map((l) => (
                <li key={`${l.key}-${l.file ?? ""}-${l.who ?? ""}`}>
                  {t(`contracts.docsign.ready.${l.key}`, { who: l.who, file: l.file })}
                </li>
              ))}
            </ul>
          </DialogBody>
        )}
        <DialogFooter>
          <Button onClick={p.onClose}>{t("contracts.docsign.ready.ok")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
