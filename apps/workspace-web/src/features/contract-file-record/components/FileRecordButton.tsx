// CR-135 · Q5 · nút «Hồ sơ» cạnh mỗi file HĐ — mở ngăn bên phải (tải lười: chỉ gọi API khi bấm).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import { FileRecordDrawer, type FileRecordTarget } from "./FileRecordDrawer";

export function FileRecordButton({
  target,
  size = "sm",
}: {
  target: FileRecordTarget;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn
        size={size}
        variant="outline"
        data-testid="file-record-btn"
        onClick={() => setOpen(true)}
      >
        {t("contracts.frec.open")}
      </Btn>
      {open && <FileRecordDrawer target={target} onClose={() => setOpen(false)} />}
    </>
  );
}
