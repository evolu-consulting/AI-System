// ADM-FR-67 · CR-056 · CR-121 R-3: trang "Chi tiết lượt chạy" của admin (`/processes/$processId/runs/$runId`).
// `processId` trong URL là KÝ HIỆU quy trình (không phải id) — chỉ để hiển thị; dữ liệu lấy theo `runId`.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { hubConfigured } from "@/lib/hub";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { RunDetailBody } from "../components/run-detail/RunDetailBody";
import { useProcessTenant } from "../hooks/use-process-tenant";
import { useRunDetail } from "../run-detail-api";

export type ProcessRunPageProps = { processId: string; runId: string };

function RunBody({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const tenant = useProcessTenant();
  const q = useRunDetail(runId, tenant.tenantId);
  if (!hubConfigured()) return <HubNotConfigured />;
  if (q.isError && !q.data) {
    const e = q.error;
    if (e instanceof ApiError && e.status === 404) return <NotFoundState backTo="/processes" />;
    if (e instanceof ApiError && e.status === 403) return <ForbiddenState />;
    return (
      <HubLoadError message={t("process.common.error.load")} onRetry={() => void q.refetch()} />
    );
  }
  if (!q.data) return <LoadingState />;
  return (
    <>
      <PageHeader
        title={t("process.admin.run.title", { name: q.data.process.name })}
        description={t("process.admin.runDetail.subtitle")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/processes">{t("process.admin.run.back")}</Link>
          </Button>
        }
      />
      <RunDetailBody runId={runId} tenant={tenant} />
    </>
  );
}

export function ProcessRunPage({ runId }: ProcessRunPageProps) {
  return (
    <ProcessRouteGate>
      <RunBody runId={runId} />
    </ProcessRouteGate>
  );
}
