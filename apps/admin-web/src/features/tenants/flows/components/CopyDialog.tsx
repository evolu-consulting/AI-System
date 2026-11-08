// CR-125 · c5b · hộp "Sao chép để sửa": nói TRƯỚC khi sao chép mẫu có dùng được ở công ty không (thiếu gì, ai cần làm gì), không đợi 422.
import { useState } from "react";
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
import { ReadinessPanel } from "./ReadinessPanel";

type Props = {
  tenantId: string;
  flowId: string;
  name: string;
  isPlatform: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function CopyDialog(p: Props) {
  const { t } = useTranslation();
  const [ok, setOk] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent data-testid="copy-dialog">
        <DialogHeader>
          <DialogTitle>{t("tenants.companyFlows.copy.title", { name: p.name })}</DialogTitle>
          <DialogDescription>{t("tenants.companyFlows.copy.hint")}</DialogDescription>
        </DialogHeader>
        <ReadinessPanel
          tenantId={p.tenantId}
          flowId={p.flowId}
          copy
          isPlatform={p.isPlatform}
          onState={setOk}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={p.onClose}>
            {t("tenants.companyFlows.copy.cancel")}
          </Button>
          <Button
            disabled={!ok}
            data-testid="copy-confirm"
            onClick={() => {
              p.onConfirm();
              p.onClose();
            }}
          >
            {t("tenants.companyFlows.copy.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
