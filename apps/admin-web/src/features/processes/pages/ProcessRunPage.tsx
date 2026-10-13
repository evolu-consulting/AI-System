// ADM-FR-67 · CR-056 · P-a F5: trang lượt chạy của admin (`/processes/$processId/runs/$runId`): Tiến độ · Token · Nhật ký.
// `processId` trong URL là KÝ HIỆU quy trình (không phải id) — chỉ để hiển thị; dữ liệu lấy theo `runId`.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClock } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { hubConfigured } from "@/lib/hub";
import { useRun } from "../api";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { AutofixBlocks } from "../components/run/autofix/AutofixBlocks";
import { OutputDialog, type OutputTarget } from "../components/run/OutputDialog";
import { RunActions } from "../components/run/RunActions";
import { RunLog } from "../components/run/RunLog";
import { RunProgress } from "../components/run/RunProgress";
import { RunStatusBadge } from "../components/run/RunStatusBadge";
import { UsageTab } from "../components/usage/UsageTab";
import { useProcessTenant } from "../hooks/use-process-tenant";

export type ProcessRunPageProps = { processId: string; runId: string };

function RunBody({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const tenant = useProcessTenant();
  const q = useRun(runId, tenant.tenantId);
  const [target, setTarget] = useState<OutputTarget | null>(null);
  if (!hubConfigured()) return <HubNotConfigured />;
  if (q.isError) {
    const e = q.error;
    if (e instanceof ApiError && e.status === 404) return <NotFoundState backTo="/processes" />;
    if (e instanceof ApiError && e.status === 403) return <ForbiddenState />;
    return (
      <HubLoadError message={t("process.common.error.load")} onRetry={() => void q.refetch()} />
    );
  }
  if (!q.data) return <LoadingState />;
  const run = q.data;
  // Admin luôn nhận `full`; `task` (người xem ngoài phòng) không áp dụng cho Evolu Control.
  if (run.access !== "full") return <NotFoundState backTo="/processes" />;
  return (
    <>
      <PageHeader
        title={t("process.admin.run.title", { name: run.process.name })}
        description={`${run.started_by.display_name} · ${formatClock(run.started_at)}`}
        actions={
          <>
            <RunStatusBadge status={run.status} />
            <Button variant="outline" asChild>
              <Link to="/processes">{t("process.admin.run.back")}</Link>
            </Button>
          </>
        }
      />
      <Tabs defaultValue="progress">
        <TabsList>
          <TabsTrigger value="progress">{t("process.admin.run.tab.progress")}</TabsTrigger>
          <TabsTrigger value="usage">{t("process.admin.run.tab.usage")}</TabsTrigger>
          <TabsTrigger value="log">{t("process.admin.run.tab.log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="progress" className="space-y-4">
          <RunActions run={run} tenantId={tenant.tenantId} />
          <RunProgress stages={run.stages} onView={setTarget} />
          <AutofixBlocks stages={run.stages} tenantId={tenant.tenantId} />
        </TabsContent>
        <TabsContent value="usage">
          <UsageTab runId={runId} tenantId={tenant.tenantId} />
        </TabsContent>
        <TabsContent value="log">
          <RunLog history={run.history} stageNames={run.stages.map((s) => s.name)} />
        </TabsContent>
      </Tabs>
      <OutputDialog
        runId={runId}
        tenantId={tenant.tenantId}
        target={target}
        stages={run.stages}
        onClose={() => setTarget(null)}
      />
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
