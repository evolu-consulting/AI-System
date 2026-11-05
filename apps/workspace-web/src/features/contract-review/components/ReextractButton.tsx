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

export function ReextractButton({ id, retry = false }: { id: string; retry?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const run = useReextract(id, () => setOpen(false));
  return (
    <>
      <button
        type="button"
        className={retry ? "btn btn-primary" : "btn btn-outline"}
        data-testid="reextract"
        onClick={() => setOpen(true)}
      >
        {t(retry ? "contracts.gapa1.reextract.retry" : "contracts.gapa1.reextract.button")}
      </button>
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
