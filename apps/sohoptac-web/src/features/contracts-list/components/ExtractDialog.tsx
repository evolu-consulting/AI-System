// ux-excel E5: hộp thoại "Upload hợp đồng" — "AI đang đọc ‹tên tệp›" + chip các bước. Chip sáng lần lượt theo thời gian (API chưa báo bước).
// Đóng do cha (xong/lỗi ⇒ `open` false); nút "Ẩn" để người dùng vẫn đi chỗ khác được.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  if (!open || hidden) return null;
  const chips = chipStates(activeStep(elapsed));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("contracts.list.upload.dialog.title")}
        className="w-full max-w-md rounded-xl border border-rule bg-panel p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{t("contracts.list.upload.dialog.title")}</h2>
        <p role="status" className="mt-2 truncate text-sm text-dim" title={name}>
          {t("contracts.list.upload.dialog.reading", { name })}
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
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
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setHidden(true)}>
            {t("contracts.list.upload.dialog.hide")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hộp cho hàng đợi tải lên ở trang danh sách: mở khi có tệp đang lên máy chủ. */
export function QueueExtractDialog({ items }: { items: UploadItem[] }) {
  const cur = items.find((i) => i.state === "uploading");
  return (
    <ExtractDialog open={dialogOpen({ uploading: cur !== undefined })} name={cur?.name ?? ""} />
  );
}
