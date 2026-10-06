// HUB-FR-60 · lỗi tải danh mục trong bước tương ứng: Alert inline + [Thử lại] (form vẫn sửa được phần khác).
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";

export function CatalogAlert({ what, retry }: { what: string; retry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive" className="flex items-center justify-between gap-3">
      <AlertDescription>{t("editor.catalogError", { what })}</AlertDescription>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        {t("editor.retry")}
      </Button>
    </Alert>
  );
}
