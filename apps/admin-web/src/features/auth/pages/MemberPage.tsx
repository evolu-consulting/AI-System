// ADM-FR-03 · khung trang member (FE1b); FE3 thêm nút Chat App và đổi mật khẩu.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";

export function MemberPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("member.title")} description={t("member.body")} />;
}
