// HD-FR-23 · HD-FR-26 · S05 · D-02: phần phụ của màn kiểm/sửa — nút xem hợp đồng gốc, thông báo sau Lưu, khối "Không đọc được"
// (`ContractPage.tsx:125-139`). Chỉ trình bày. (V2-F: cảnh báo chuyển vào "Tóm tắt", bảng hàng vào "Sản phẩm".)
import { FileText } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { useReplaceFile, useStartManual } from "../hooks/use-manage";
import { failReasonKey } from "../lib/fail-reason";
import { FailedActions } from "./FailedActions";
import { ReextractDialog } from "./ReextractButton";

export type FileRef = { href: string; name: string; onOpen: () => void };

/** «Xem hợp đồng gốc» (CR-162): nút chỉ icon + chú thích khi rê/focus + nhãn đọc màn hình. Giữ `<a>` (khung/ảnh), bấm ⇒ `onOpen` (xin link có Bearer, #220). */
export function FileLink({ file, className = "" }: { file: FileRef; className?: string }) {
  const { t } = useTranslation();
  const label = t("contracts.review.viewFile");
  return (
    <span className={`group relative inline-flex ${className}`}>
      <a
        href={file.href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        className="btn-icon-ghost text-act"
        onClick={(e) => {
          e.preventDefault();
          file.onOpen();
        }}
      >
        <FileText size={18} aria-hidden />
      </a>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-30 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-caption text-panel group-focus-within:block group-hover:block"
      >
        {label}
      </span>
    </span>
  );
}

/** Lỗi sau "Lưu". Thành công báo bằng toast (không khối giữ chỗ giữa banner khoá và "Hạn chót"); không có lỗi ⇒ không render gì. */
export function SaveNotice({ err }: { err: string | null }) {
  return (
    <>
      {err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {err}
        </p>
      )}
    </>
  );
}

export function ExtractFailed({
  file,
  id,
  write,
  error,
}: {
  file: FileRef | null;
  id: string;
  /** gap-a1 #5: vai có quyền ghi ⇒ nút "Thử lại" (đọc lại bằng AI). */
  write: boolean;
  /** Mã lỗi của lượt đọc (`contract.error`) — chọn câu lý do. */
  error?: string | null;
}) {
  const { t } = useTranslation();
  const reason = failReasonKey(error);
  const replace = useReplaceFile(id); // CR-157b: tải tệp khác ⇒ AI đọc lại
  const manual = useStartManual(id); // CR-157: nhập tay ngay trên HĐ này (không còn dẫn sang trang tạo trống)
  const [retry, setRetry] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  return (
    <Panel className="mb-4 p-5">
      <p className="font-medium text-late">{t("contracts.review.failedTitle")}</p>
      <p className="mt-1 text-sm text-dim">
        {t(reason ? `contracts.review.failReason.${reason}` : "contracts.review.failedBody")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {write && (
          <FailedActions
            pending={manual.isPending}
            onManual={() => manual.mutate(undefined)}
            onRetry={() => setRetry(true)}
            onPickFile={() => pick.current?.click()}
          />
        )}
        {file && <FileLink file={file} />}
      </div>
      {write && (
        <>
          <span data-testid="replace-file" hidden>
            <input
              ref={pick}
              type="file"
              hidden
              accept=".pdf,.docx,.jpg,.jpeg,.png,.md"
              disabled={replace.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) replace.mutate(f);
              }}
            />
          </span>
          <ReextractDialog id={id} open={retry} onOpenChange={setRetry} />
        </>
      )}
    </Panel>
  );
}
