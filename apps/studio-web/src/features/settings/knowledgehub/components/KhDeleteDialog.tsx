// HUB-FR-131 · mockup 1b · xoá kết nối (`alertdialog`): "Secret không bị xoá."; 409 KH_CONNECTION_IN_USE ⇒ Alert trong hộp, không đóng.
import type { KhConnection } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert, AlertDescription } from "#/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { describeApiError, type MessageSpec } from "#/lib/api-error";
import { useKhMutations } from "../hooks/use-kh-mutations";

type Props = { target: KhConnection | null; onClose: () => void };
const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;

export function KhDeleteDialog({ target, onClose }: Props) {
  const { t } = useTranslation();
  const m = useKhMutations();
  const [inUse, setInUse] = useState<MessageSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setInUse(null);
    onClose();
  };
  const confirm = async (c: KhConnection) => {
    setBusy(true);
    try {
      await m.remove({ id: c.id, version: c.version });
      toast.success(t("knowledgehub.toast.deleted", { name: c.name }));
      close();
    } catch (err) {
      if (codeOf(err) === "KH_CONNECTION_IN_USE") {
        setInUse(describeApiError(err));
        m.reload();
        return;
      }
      m.reload();
      if (codeOf(err) === "VERSION_CONFLICT") toast.error(t("knowledgehub.toast.conflictDelete"));
      else if (codeOf(err) !== "NOT_FOUND") {
        const spec = describeApiError(err);
        toast.error(t(spec.key, spec.params));
      }
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("knowledgehub.delete.title", { name: target?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("knowledgehub.delete.body", { name: target?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {inUse ? (
          <Alert variant="destructive">
            <AlertDescription>{t(inUse.key, inUse.params)}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              if (target) void confirm(target);
            }}
          >
            {t("knowledgehub.delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
