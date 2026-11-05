// Popup "Đã hết lượt tải hợp đồng hôm nay": hiện một lần mỗi lô khi máy chủ trả 429 UPLOAD_QUOTA.
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { type QuotaNotice, quotaPopupText } from "../lib/upload-quota";

export function QuotaDialog({
  notice,
  onClose,
}: {
  notice: QuotaNotice | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (!notice) return null;
  const text = quotaPopupText(notice, t as never, i18n.language?.startsWith("en") ? "en" : "vi");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("contracts.list.upload.quotaPopup.ok")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
