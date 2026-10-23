// V2-M · HD-07: nút "Xoá hợp đồng" (chỉ vai quản lý) ⇒ hộp xác nhận liệt kê tác động (xem trước) ⇒ xoá hẳn, về danh sách.
// products-confirm: SP gắn HĐ mà không còn HĐ nào khác dùng ⇒ ô chọn "Xoá các sản phẩm không còn hợp đồng nào dùng?" (mặc định không
// chọn); chỉ SP được tick mới bị xoá theo. Hộp tách ra (`DeleteContractDialog`) để danh sách dùng lại.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DeleteContractDialog } from "./DeleteContractDialog";

export function DeleteContractButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-outline"
        data-testid="delete-contract"
        onClick={() => setOpen(true)}
      >
        {t("contracts.del.button")}
      </button>
      {open && <DeleteContractDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
