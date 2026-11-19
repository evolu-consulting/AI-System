// CR-188 · BR-188-6 · hộp «Kiểm tra tệp»; `from` = HĐ đang mở từ «⋯» (khớp HĐ khác ⇒ báo «bản đã ký của HĐ khác»).
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import { useTranslation } from "react-i18next";
import { VerifyFilePanel, type VerifyFrom } from "./VerifyFilePanel";

export function VerifyFileDialog({
  open,
  from,
  onClose,
}: {
  open: boolean;
  from?: VerifyFrom | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="verify-dialog" closeLabel={t("contracts.verify.close")}>
        <DialogHeader>
          <DialogTitle>{t("contracts.verify.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <VerifyFilePanel from={from} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
