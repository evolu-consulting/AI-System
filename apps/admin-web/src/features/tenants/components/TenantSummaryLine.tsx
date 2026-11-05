// CR-121 · một dòng tóm tắt ở đầu trang công ty (thay tab "Tổng quan"): số người dùng · ứng dụng đang bật · số vai.
import { useTranslation } from "react-i18next";
import { useTenantOverview } from "../hooks/use-tenant-overview";

export function TenantSummaryLine({ tenantId, users }: { tenantId: string; users: number }) {
  const { t } = useTranslation();
  const o = useTenantOverview(tenantId);
  if (o.pending || o.error) return <p className="mb-3 h-5" aria-hidden="true" />;
  return (
    <p className="mb-3 text-label text-muted-foreground" data-testid="tenant-summary">
      {t("tenants.summary", { users, apps: o.apps?.length ?? 0, roles: o.roleCount ?? 0 })}
    </p>
  );
}
