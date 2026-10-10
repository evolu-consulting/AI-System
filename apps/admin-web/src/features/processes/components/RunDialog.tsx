// ADM-FR-67 · CR-056 · P-a F5: hộp thoại "Chạy quy trình {tên}" — nhập `input` ≤ 8000, lỗi 429/404 hiện trong hộp (plan-frontend-admin §1).
import { PROCESS_INPUT_MAX, type ProcessDefListItem } from "@ai/contracts/hub-admin";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStartRun } from "../hooks/use-run-data";
import { processErrorSpec } from "../lib/errors";

type Props = {
  row: ProcessDefListItem | null;
  tenantId: string | undefined;
  onClose: () => void;
};

export function RunDialog({ row, tenantId, onClose }: Props) {
  const { t } = useTranslation();
  const run = useStartRun(tenantId);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: xoá nhập/lỗi mỗi khi mở cho một quy trình khác
  useEffect(() => {
    setText("");
    setError(null);
  }, [row?.id]);
  const tooLong = text.length > PROCESS_INPUT_MAX;
  const submit = async () => {
    if (!row || tooLong) return;
    setError(null);
    try {
      await run.start(row.id, text.trim());
      notifySuccess(t("process.admin.list.toast.started"));
      onClose();
    } catch (err) {
      const spec = processErrorSpec(err);
      setError(t(spec.key, spec.params));
    }
  };
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && !run.pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("process.admin.list.run.title", { name: row?.name ?? "" })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="process-run-input">{t("process.admin.list.run.input")}</Label>
          <Textarea
            id="process-run-input"
            value={text}
            rows={5}
            aria-invalid={tooLong || undefined}
            onChange={(e) => setText(e.target.value)}
          />
          {tooLong ? (
            <p role="alert" className="text-label text-destructive">
              {t("process.admin.validate.tooLongN", { max: PROCESS_INPUT_MAX })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-label text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.pending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={run.pending || tooLong}>
            {t("process.admin.list.run.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
