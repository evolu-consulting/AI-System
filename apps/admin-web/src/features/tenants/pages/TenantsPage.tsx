// ADM-FR-60 · khung trang Tenants (FE1b); FE4 thay bằng danh sách thật.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { useSession } from "@/lib/use-session";

export function TenantsPage() {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  if (role !== "platform_admin") return <ForbiddenState />;
  return <PageHeader title={t("tenants.list.title")} description={t("tenants.list.subtitle")} />;
}
