// CR-121 · một dòng tóm tắt ở đầu trang công ty: "6 người dùng · 2 ứng dụng · 4/5 việc có quy trình" (c14: thêm số việc có quy trình,
// liên kết sang tab Quy trình khi còn việc chưa có quy trình).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCompanyFlows } from "../flows/hooks/use-company-flows";
import { useTenantOverview } from "../hooks/use-tenant-overview";

export function TenantSummaryLine({ tenantId, users }: { tenantId: string; users: number }) {
  const { t } = useTranslation();
  const o = useTenantOverview(tenantId);
  const f = useCompanyFlows(tenantId);
  if (o.pending || o.error) return <p className="mb-3 h-5" aria-hidden="true" />;
  const { on, total } = f.summary;
  const flows = t("tenants.summaryFlows", { on, total });
  return (
    <p className="mb-3 text-label text-muted-foreground" data-testid="tenant-summary">
      {t("tenants.summary", { users, apps: o.apps?.length ?? 0, roles: o.roleCount ?? 0 })}
      {f.pending || total === 0 ? null : (
        <>
          {" · "}
          {on < total ? (
            <Link
              to="/tenants/$tenantId"
              params={{ tenantId }}
              search={{ tab: "processes" }}
              className="underline-offset-4 hover:underline"
              data-testid="summary-flows"
            >
              {flows}
            </Link>
          ) : (
            <span data-testid="summary-flows">{flows}</span>
          )}
        </>
      )}
    </p>
  );
}
