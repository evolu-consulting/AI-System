// ADM-FR-62 · /groups/$groupId (chỗ giữ chỗ của FE2a; FE2b thay bằng editor 3 tab).
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";

export function GroupEditorPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("groups.list.title")} />;
}
