// ux-excel E5: hộp thoại "Upload hợp đồng" — "AI đang đọc ‹tên tệp›" + chip các bước. Chip sáng lần lượt theo thời gian (API chưa báo bước).
// Đóng do cha (xong/lỗi ⇒ `open` false); nút "Ẩn" để người dùng vẫn đi chỗ khác được.
import { Button } from "@ai/web-kit/ui/kit/button";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  activeStep,
  type ChipState,
  chipStates,
  dialogOpen,
  EXTRACT_STEPS,
} from "../lib/extract-progress";
import type { UploadItem } from "../lib/upload-queue";

const TONE: Record<ChipState, string> = {
  done: "border-ok text-ok",
  active: "border-act bg-act-soft text-act animate-pulse",
  todo: "border-rule text-dim",
};

function useElapsed(running: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!running) return setMs(0);
    const t0 = Date.now();
    const h = setInterval(() => setMs(Date.now() - t0), 1000);
    return () => clearInterval(h);
  }, [running]);
  return ms;
}

export function ExtractDialog({ open, name }: { open: boolean; name: string }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  const elapsed = useElapsed(open);
  useEffect(() => {
    if (!open) setHidden(false);
  }, [open]);
  const chips = chipStates(activeStep(elapsed));
  return (
    <Dialog open={open && !hidden} onOpenChange={(o) => !o && setHidden(true)}>
      <DialogContent
        aria-label={t("contracts.list.upload.dialog.title")}
        showCloseButton={false}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t("contracts.list.upload.dialog.title")}</DialogTitle>
          <DialogDescription role="status" className="truncate text-sm text-dim" title={name}>
            {t("contracts.list.upload.dialog.reading", { name })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-wrap gap-2">
            {EXTRACT_STEPS.map((s, i) => (
              <li
                key={s}
                data-state={chips[i]}
                className={`rounded-full border px-3 py-1 text-[13px] ${TONE[chips[i] ?? "todo"]}`}
              >
                {t(`contracts.list.upload.dialog.steps.${s}`)}
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter className="flex-row justify-end">
          <Button variant="quiet" size="sm" onClick={() => setHidden(true)}>
            {t("contracts.list.upload.dialog.hide")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hộp cho hàng đợi tải lên ở trang danh sách: mở khi có tệp đang lên máy chủ. */
export function QueueExtractDialog({ items }: { items: UploadItem[] }) {
  const cur = items.find((i) => i.state === "uploading");
  return (
    <ExtractDialog open={dialogOpen({ uploading: cur !== undefined })} name={cur?.name ?? ""} />
  );
}
