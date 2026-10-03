// ADM-FR-41, ADM-FR-42 · Tổng quan `/`: platform_admin → bản Main, tenant_admin → bản TenantOverview (plan-frontend §3.3). member đã bị chuyển sang /member.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { useSession } from "@/lib/auth/use-session";
import { formatClock } from "@/lib/format";
import { loadError } from "@/lib/load-error";
import { useOverview } from "../api";
import { PlatformActions, PlatformOverview } from "../components/PlatformOverview";
import { TenantOverview } from "../components/TenantOverview";

type Data = ReturnType<typeof useOverview>["data"];

function useDescription(platform: boolean, data: Data, updatedAt: number, tenantName: string) {
  const { t } = useTranslation();
  if (platform) {
    const n = data?.kind === "platform" ? data.tenants_active : 0;
    return t("overview.platform.subtitle", { n, time: formatClock(updatedAt || Date.now()) });
  }
  const tenant = data?.kind === "tenant" ? data.tenant.name : tenantName;
  const month = data?.kind === "tenant" ? data.month.split("-").reverse().join("/") : "";
  return t("overview.subtitle", { tenant, month });
}

export function OverviewPage() {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const tenantName = useSession((s) => s.me?.tenant.name ?? "");
  const q = useOverview();
  const err = q.isError
    ? {
        ...(loadError(q.error) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" }),
        onRetry: () => void q.refetch(),
      }
    : null;
  const data = q.data;
  const platform = role === "platform_admin";
  const description = useDescription(platform, data, q.dataUpdatedAt, tenantName);
  return (
    <>
      <PageHeader
        title={t("overview.title")}
        description={description}
        actions={platform ? <PlatformActions /> : undefined}
      />
      {platform ? (
        <PlatformOverview
          data={data?.kind === "platform" ? data : undefined}
          loading={q.isPending}
          error={err}
        />
      ) : (
        <TenantOverview
          data={data?.kind === "tenant" ? data : undefined}
          loading={q.isPending}
          error={err}
        />
      )}
    </>
  );
}
