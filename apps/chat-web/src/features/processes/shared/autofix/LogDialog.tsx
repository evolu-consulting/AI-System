// HUB-FR-128 · P-c1 §1.2 · "Xem log": Dialog đuôi 30 dòng log test (đã che bí mật phía Runtime). Chỉ tải khi mở.
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { type LoadContent, useAutofixLog } from "./use-autofix-content";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fileId: string;
  load: LoadContent;
  onDownload: () => void;
};

export function LogDialog({ open, onOpenChange, fileId, load, onDownload }: Props) {
  const { t } = useTranslation();
  const log = useAutofixLog(fileId, load, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("process.common.autofix.viewLog")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("process.common.autofix.viewLog")}
        </DialogDescription>
        {log.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("process.common.autofix.download.err")}
          </p>
        ) : (
          <pre
            aria-busy={log.isLoading}
            className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-caption"
          >
            {log.text ?? ""}
          </pre>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={onDownload}
        >
          {t("process.common.autofix.fullLog")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
