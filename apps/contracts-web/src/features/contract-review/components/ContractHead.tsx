// V2-F · HD-09 · S05: đầu trang HĐ — bước xác nhận sau upload dùng thanh Hủy/Lưu DÍNH như form nhập tay; còn lại là tiêu đề thường + file gốc
// + nút duyệt (HD3). Chỉ trình bày.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageHead } from "~/components/shared/layout";
import { FormBar } from "~/features/contract-form/components/FormBar";
import { type FileRef, ReviewActions } from "./ReviewParts";

type Props = {
  title: string;
  lead: ReactNode;
  /** Bước xác nhận (`needs_review`) mà người dùng có quyền ghi ⇒ thanh dính. */
  sticky: boolean;
  file: FileRef | null;
  canSave: boolean;
  /** Huỷ: có sửa ⇒ bỏ sửa; chưa sửa ⇒ về danh sách (luôn làm gì đó). */
  onCancel: () => void;
  saveButton: ReactNode;
  /** "Xác nhận và lưu" của trang (tenant tắt duyệt). */
  confirmButton: ReactNode;
  approvalButtons: ReactNode;
  approvalBusy: boolean;
};

export function ContractHead(p: Props) {
  const { t } = useTranslation();
  const crumb = (
    <Link to="/contracts" className="hover:underline">
      {t("contracts.review.back")}
    </Link>
  );
  const fileLink = (
    <ReviewActions file={p.file} canSave={false} busy={p.approvalBusy} onSave={() => undefined} />
  );
  if (p.sticky)
    return (
      <FormBar
        crumb={crumb}
        title={p.title}
        lead={p.lead}
        cancel={
          <button type="button" className="btn btn-quiet" onClick={p.onCancel}>
            {t("contracts.common.cancel")}
          </button>
        }
        save={
          <>
            {fileLink}
            {p.saveButton}
            {p.confirmButton}
            {p.approvalButtons}
          </>
        }
      />
    );
  return (
    <PageHead
      crumb={crumb}
      title={p.title}
      lead={p.lead}
      actions={
        (p.file || p.canSave) && (
          <>
            {fileLink}
            {p.approvalButtons}
          </>
        )
      }
    />
  );
}
