// gap-a1 #5 · "AI đọc lại từ đầu" (HĐ chờ xác nhận) / "Thử lại" (đọc lỗi): hộp xác nhận rồi gọi trích lại có sẵn (`POST /extract`, 202).
// Đọc lại ghi đè phần AI đã đọc nhưng giữ ô người đã sửa.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useReextract } from "../hooks/use-manage";

export function ReextractButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-outline"
        data-testid="reextract"
        onClick={() => setOpen(true)}
      >
        {t("contracts.gapa1.reextract.button")}
      </button>
      <ReextractDialog id={id} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Hộp xác nhận đọc lại — dùng cho nút «AI đọc lại» và mục «Thử lại» trong cụm của thẻ «Không đọc được». */
export function ReextractDialog({
  id,
  open,
  onOpenChange: setOpen,
}: {
  id: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const run = useReextract(id, () => setOpen(false));
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("contracts.gapa1.reextract.title")}</DialogTitle>
            <DialogDescription>{t("contracts.gapa1.reextract.warn")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
              {t("contracts.common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="reextract-confirm"
              disabled={run.isPending}
              onClick={() => run.mutate(undefined)}
            >
              {t(
                run.isPending
                  ? "contracts.gapa1.reextract.running"
                  : "contracts.gapa1.reextract.confirm",
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
