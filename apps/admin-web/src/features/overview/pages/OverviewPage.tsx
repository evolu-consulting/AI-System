// ADM-FR-41, ADM-FR-42 · CR-121 C-3b · Tổng quan `/`: platform_admin → bento vận hành (Hub `/ops/overview`), tenant_admin → bản TenantOverview. member đã bị chuyển sang /member.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { formatClock } from "@/lib/format";
import { loadError } from "@/lib/load-error";
import { useOpsOverview, useOverview } from "../api";
import { OpsBento } from "../components/ops/OpsBento";
import { TenantOverview } from "../components/TenantOverview";

function PlatformActions() {
  const { t } = useTranslation();
  return (
    <>
      <Button asChild variant="outline">
        <Link to="/commands/new">{t("overview.platform.createCommand")}</Link>
      </Button>
      <Button asChild>
        <Link to="/tenants/new">{t("overview.platform.createTenant")}</Link>
      </Button>
    </>
  );
}

function PlatformPage() {
  const { t } = useTranslation();
  const q = useOpsOverview(true);
  const time = q.data ? formatClock(q.dataUpdatedAt) : "—";
  return (
    <>
      <PageHeader
        title={t("overview.title")}
        description={t("overview.ops.subtitle", { time })}
        actions={<PlatformActions />}
      />
      <OpsBento />
    </>
  );
}

function TenantPage() {
  const { t } = useTranslation();
  const tenantName = useSession((s) => s.me?.tenant.name ?? "");
  const q = useOverview();
  const err = q.isError
    ? {
        ...(loadError(q.error) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" }),
        onRetry: () => void q.refetch(),
      }
    : null;
  const data = q.data?.kind === "tenant" ? q.data : undefined;
  const month = data ? data.month.split("-").reverse().join("/") : "";
  return (
    <>
      <PageHeader
        title={t("overview.title")}
        description={t("overview.subtitle", { tenant: data?.tenant.name ?? tenantName, month })}
      />
      <TenantOverview data={data} loading={q.isPending} error={err} />
    </>
  );
}

export function OverviewPage() {
  const role = useSession((s) => s.me?.role);
  return role === "platform_admin" ? <PlatformPage /> : <TenantPage />;
}
