// CR-125 · UX H6 · câu báo tệp bị giữ lại vì công ty đã bật ký số mà tệp không phải PDF (nói cách khắc phục).
import { useTranslation } from "react-i18next";

export function NeedPdfNotice({ names }: { names: string[] }) {
  const { t } = useTranslation();
  if (names.length === 0) return null;
  return (
    <p role="alert" data-testid="upload-need-pdf" className="mb-3 text-sm text-late">
      {t("contracts.list.upload.needPdf", { names: names.join(", ") })}
    </p>
  );
}
