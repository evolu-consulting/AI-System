// ADM-FR-01 · khung trang đăng nhập (FE1b); FE3 thay bằng form thật.
import { useTranslation } from "react-i18next";
import { BareLayout } from "@/features/shell/components/BareLayout";
import { useDocumentTitle } from "@/lib/use-document-title";

export function LoginPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("auth.login.title"));
  return (
    <BareLayout>
      <h1 className="text-page-title font-bold">{t("auth.login.title")}</h1>
    </BareLayout>
  );
}
