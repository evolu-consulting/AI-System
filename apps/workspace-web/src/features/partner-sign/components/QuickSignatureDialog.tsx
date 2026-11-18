// CR-182 · lần đầu bấm «Xem và ký»: hộp «Tạo chữ ký của bạn» (Gõ tên | Vẽ). Dùng lại SignatureCreator ở chế độ rút gọn (không tải ảnh lên, mực xanh).
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai/web-kit/ui/kit/dialog";
import { useTranslation } from "react-i18next";
import { SignatureCreator } from "~/features/my-signature/components/SignatureCreator";

const METHODS = ["type", "draw"] as const;
const NO_CAPTION = { name: false, title: false, date: false, time: false };

export function QuickSignatureDialog(p: {
  open: boolean;
  name: string;
  onSave: (png: Blob, method: "type" | "draw") => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent data-testid="partner-quick" closeLabel={t("contracts.docsign.close")}>
        <DialogHeader>
          <DialogTitle>{t("contracts.psign.quick.title")}</DialogTitle>
          <DialogDescription>{t("contracts.psign.quick.desc")}</DialogDescription>
        </DialogHeader>
        <SignatureCreator
          methods={[...METHODS]}
          ink="blue"
          caption={NO_CAPTION}
          person={{ name: p.name }}
          allowLater={false}
          step="main"
          onSave={(png, m) => p.onSave(png, m === "draw" ? "draw" : "type")}
        />
      </DialogContent>
    </Dialog>
  );
}
