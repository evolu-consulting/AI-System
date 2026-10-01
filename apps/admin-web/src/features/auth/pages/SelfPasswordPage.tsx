// ADM-FR-03 · khung trang tự đổi mật khẩu (FE1b); FE3 thêm form.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";

export function SelfPasswordPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("password.self.title")} description={t("password.self.body")} />;
}
