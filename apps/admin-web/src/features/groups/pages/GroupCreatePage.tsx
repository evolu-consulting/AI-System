// ADM-FR-62 · /groups/new (chỗ giữ chỗ của FE2a; FE2b thay bằng form tạo group).
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";

export function GroupCreatePage() {
  const { t } = useTranslation();
  return <PageHeader title={t("groups.editor.titleNew")} />;
}
