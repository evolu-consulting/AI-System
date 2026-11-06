// ADM-FR-66 · CR-056 · P-a F5: thanh lưu dính đáy của editor quy trình ("Chưa lưu thay đổi" · Huỷ · Lưu).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useLibraryCanvas } from "../library/library-canvas-ctx";

/** `version` (đã lưu) hiện thành chữ trạng thái thay cho toast — toast ở góc dưới phải sẽ che nút Lưu. */
type Props = {
  dirty: boolean;
  pending: boolean;
  formId: string;
  version?: number;
  /** CR-121 c17b · bản RIÊNG của công ty (sửa thẳng, không Xuất bản): nói rõ lưu là áp dụng ngay cho lượt mới. */
  companyCopy?: boolean;
};

export function ProcessSaveBar({ dirty, pending, formId, version, companyCopy }: Props) {
  const { t } = useTranslation();
  const lib = useLibraryCanvas() !== null; // CR-105 UX: quy trình khe ⇒ "Lưu nháp" (khác "Xuất bản")
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="min-w-0 flex-1 text-label text-muted-foreground">
        {dirty
          ? t("common.unsaved")
          : version === undefined
            ? null
            : t("common.savedVersion", { n: version })}
        {companyCopy ? (
          <span className="block" data-testid="copy-save-note">
            {t("process.admin.editor.copySaveNote")}
          </span>
        ) : null}
      </div>
      <Button variant="outline" asChild>
        <Link to="/processes">{t("common.cancel")}</Link>
      </Button>
      <Button type="submit" form={formId} disabled={pending} aria-disabled={pending}>
        {t(lib ? "process.admin.library.saveDraft" : "common.save")}
      </Button>
    </div>
  );
}
