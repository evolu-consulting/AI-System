// ADM-FR-66 · CR-056 · P-a F5: thanh lưu dính đáy của editor quy trình ("Chưa lưu thay đổi" · Huỷ · Lưu).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** `version` (đã lưu) hiện thành chữ trạng thái thay cho toast — toast ở góc dưới phải sẽ che nút Lưu. */
type Props = { dirty: boolean; pending: boolean; formId: string; version?: number };

export function ProcessSaveBar({ dirty, pending, formId, version }: Props) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="min-w-0 flex-1 text-label text-muted-foreground">
        {dirty
          ? t("common.unsaved")
          : version === undefined
            ? null
            : t("common.savedVersion", { n: version })}
      </div>
      <Button variant="outline" asChild>
        <Link to="/processes">{t("common.cancel")}</Link>
      </Button>
      <Button type="submit" form={formId} disabled={pending} aria-disabled={pending}>
        {t("common.save")}
      </Button>
    </div>
  );
}
