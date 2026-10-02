// ADM-FR-35, ADM-FR-36 · /access (chỗ giữ chỗ của FE2a để menu "Phân quyền" có đích; FE3a thay bằng 2 tab Ma trận · Kiểm tra quyền).
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";

export function AccessPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("access.title")} />;
}
