// HUB-FR-60 · CR-080 · bước ⑤ Quyền (chỉ hiện số tenant đã cấp).
import { useTranslation } from "react-i18next";

export function AccessSection({ granted }: { granted: number }) {
  const { t } = useTranslation();
  return (
    <p className="text-body text-muted-foreground">{t("editor.access.count", { n: granted })}</p>
  );
}
