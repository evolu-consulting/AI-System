// HUB-FR-60 · bước ⑤ Quyền (H4a chỉ hiện số tenant đã cấp; quản lý quyền là H4b).
import { useTranslation } from "react-i18next";
import { SoonBadge } from "#/components/shared/SoonBadge";
import { Button } from "#/components/ui/button";

export function AccessSection({ granted }: { granted: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-body text-muted-foreground">{t("editor.access.count", { n: granted })}</p>
      <Button type="button" variant="outline" disabled>
        {t("editor.access.manage")} <SoonBadge kind="soonH4b" />
      </Button>
    </div>
  );
}
