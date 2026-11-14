// HD-FR-23 · HD-FR-26 · S05 · D-02: phần phụ của màn kiểm/sửa — nút "Xem file gốc", thông báo sau Lưu, khối "Không đọc được"
// (`ContractPage.tsx:125-139`). Chỉ trình bày. (V2-F: cảnh báo chuyển vào "Tóm tắt", bảng hàng vào "Sản phẩm".)
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { useReplaceFile, useStartManual } from "../hooks/use-manage";
import { failReasonKey } from "../lib/fail-reason";
import { ReextractButton } from "./ReextractButton";

export type FileRef = { href: string; name: string; onOpen: () => void };

/** "📄 Xem file gốc": giữ `<a>` như mgmt-app (khung/ảnh), bấm ⇒ `onOpen` (xin link có Bearer, #220). */
export function FileLink({ file, title }: { file: FileRef; title?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={file.href}
      target="_blank"
      rel="noreferrer"
      className="text-[13px] font-medium text-act hover:underline"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        file.onOpen();
      }}
    >
      {t("contracts.review.viewFile")}
    </a>
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
  return (
    <Panel className="mb-4 p-5">
      <p className="font-medium text-late">{t("contracts.review.failedTitle")}</p>
      <p className="mt-1 text-sm text-dim">
        {t(reason ? `contracts.review.failReason.${reason}` : "contracts.review.failedBody")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {write && <ReextractButton id={id} retry />}
        {file && <FileLink file={file} />}

        {write && (
          <label className="btn btn-outline cursor-pointer" data-testid="replace-file">
            {t("contracts.review.replaceFile")}
            <input
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
          </label>
        )}
        {write && (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="manual-entry"
            disabled={manual.isPending}
            onClick={() => manual.mutate(undefined)}
          >
            {t("contracts.review.manual")}
          </button>
        )}
      </div>
    </Panel>
  );
}
