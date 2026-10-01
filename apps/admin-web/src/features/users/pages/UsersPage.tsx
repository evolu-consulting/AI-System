// ADM-FR-04 · khung trang Users (FE1b); FE5 thay bằng danh sách thật.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { useSession } from "@/lib/use-session";

export function UsersPage() {
  const { t } = useTranslation();
  const tenant = useSession((s) => s.me?.tenant.key ?? "");
  return (
    <PageHeader title={t("users.list.title")} description={t("users.list.subtitle", { tenant })} />
  );
}
