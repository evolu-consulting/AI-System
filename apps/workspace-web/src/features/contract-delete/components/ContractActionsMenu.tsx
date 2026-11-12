// CR-127 · Z8 / CR-128 (e): menu «Thao tác ▾» của trang chi tiết HĐ — gom mọi thao tác phụ (Rút về, Tạm khoá, Trả lại, Từ chối… do `items` truyền vào)
// và «Xoá hợp đồng» CUỐI, màu đỏ, có vạch ngăn (theo `can.delete` của máy chủ). Bấm Xoá ⇒ hộp xác nhận + xem trước tác động (`DeleteContractDialog`).
// Không có mục nào ⇒ không hiện menu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type PopItem, PopMenu } from "~/components/shared/pop-menu";
import { btnClass } from "~/components/ui/Btn";
import { DeleteContractDialog } from "./DeleteContractDialog";

export function ContractActionsMenu({
  id,
  canDelete,
  items = [],
  busy,
}: {
  id: string;
  canDelete: boolean;
  items?: PopItem[];
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const all: PopItem[] = canDelete
    ? [
        ...items,
        {
          key: "delete",
          label: t("contracts.del.button"),
          testId: "act-delete",
          danger: true,
          onSelect: () => setOpen(true),
        },
      ]
    : items;
  if (all.length === 0) return null;
  return (
    <>
      <PopMenu
        trigger={<>{t("contracts.del.menu")} ▾</>}
        ariaLabel={t("contracts.del.menu")}
        triggerClass={btnClass("quiet", "sm")}
        triggerTestId="head-actions-menu"
        items={all}
        busy={busy}
      />
      {open && <DeleteContractDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
