// HD-FR-23 · HD-FR-26 · S05 · D-02: phần phụ của màn kiểm/sửa — nút "Xem file gốc", thông báo sau Lưu, khối "Không đọc được"
// (`ContractPage.tsx:125-139`). Chỉ trình bày. (V2-F: cảnh báo chuyển vào "Tóm tắt", bảng hàng vào "Sản phẩm".)
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { ReextractButton } from "./ReextractButton";

export type FileRef = { href: string; name: string; onOpen: () => void };

/** "📄 Xem file gốc": giữ `<a>` như mgmt-app (khung/ảnh), bấm ⇒ `onOpen` (xin link có Bearer, #220). */
function FileLink({ file, title }: { file: FileRef; title?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={file.href}
      target="_blank"
      rel="noreferrer"
      className="btn btn-outline"
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

/** Nút trên tiêu đề (`ContractPage.tsx:95-109`): "Xem file gốc" + "Lưu" ("Xác nhận" thuộc HD3). */
export function ReviewActions({
  file,
  canSave,
  busy,
  onSave,
}: {
  file: FileRef | null;
  canSave: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {file && <FileLink file={file} title={file.name} />}
      {canSave && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onSave}>
          {busy ? t("contracts.review.saving") : t("contracts.common.save")}
        </button>
      )}
    </>
  );
}

/** Thông báo sau "Lưu" (`ContractPage.tsx:118-119`). */
export function SaveNotice({ msg, err }: { msg: string | null; err: string | null }) {
  return (
    <>
      {msg && (
        <p role="status" className="mb-3 text-sm text-ok">
          {msg}
        </p>
      )}
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
}: {
  file: FileRef | null;
  id: string;
  /** gap-a1 #5: vai có quyền ghi ⇒ nút "Thử lại" (đọc lại bằng AI). */
  write: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Panel className="mb-4 p-5">
      <p className="font-medium text-late">{t("contracts.review.failedTitle")}</p>
      <p className="mt-1 text-sm text-dim">{t("contracts.review.failedBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {write && <ReextractButton id={id} retry />}
        {file && <FileLink file={file} />}

        <Link to="/contracts/new" className="btn btn-primary">
          {t("contracts.review.manual")}
        </Link>
      </div>
    </Panel>
  );
}
