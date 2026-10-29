// CR-103 · R4 fnr-showcase: `/processes/showcase` — flow mẫu "Duyệt đề nghị chi": canvas chỉ đọc, form input + "Chạy thử",
// tiến độ/nhật ký trực tiếp, nút Đạt/Chưa đạt ngay trên trang, ô "Đổi node" (minh hoạ R3). Chạy được khi AI tạm ngưng
// (node `set`/`if` không gọi AI). Def mẫu do `tools/scripts/src/seed-flow-showcase.ts` tạo (chỉ tenant demo).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Panel } from "@/components/shared/panel/Panel";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { hubConfigured } from "@/lib/hub";
import { CanvasView } from "../components/canvas/CanvasView";
import { type StageView, stageViews } from "../components/canvas/stage-view";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { OutputDialog, type OutputTarget } from "../components/run/OutputDialog";
import { RunActions } from "../components/run/RunActions";
import { RunLog } from "../components/run/RunLog";
import { RunProgress } from "../components/run/RunProgress";
import { RunStatusBadge } from "../components/run/RunStatusBadge";
import { NodeSwapBox } from "../components/showcase/NodeSwapBox";
import { ShowcaseInputs } from "../components/showcase/ShowcaseInputs";
import { useEditorRefs } from "../hooks/use-editor-refs";
import { useProcessTenant } from "../hooks/use-process-tenant";
import { useShowcaseDef, useShowcaseRun, useShowcaseStart } from "../hooks/use-showcase";
import type { StageOps } from "../hooks/use-stage-ops";
import { toDraft } from "../lib/def-form";
import { processErrorSpec } from "../lib/errors";
import { toInputValues } from "../lib/showcase";
import { runBadgeStatus } from "../lib/stage-label";

const K = "process.admin.showcase.";
// Canvas chỉ đọc: mọi thao tác sửa bị vô hiệu bằng `readOnly`; `ops` chỉ để thoả kiểu.
const NOOP_OPS = new Proxy({}, { get: () => () => undefined }) as StageOps;
const noop = () => undefined;

function RunPanel({ runId, tenantId }: { runId: string; tenantId: string | undefined }) {
  const { t } = useTranslation();
  const q = useShowcaseRun(runId, tenantId);
  const [target, setTarget] = useState<OutputTarget | null>(null);
  if (q.isError)
    return (
      <HubLoadError message={t("process.common.error.load")} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <LoadingState />;
  const run = q.data;
  if (run.access !== "full") return null;
  return (
    <div className="space-y-4" data-testid="showcase-run">
      <div className="flex items-center gap-2">
        <RunStatusBadge status={runBadgeStatus(run.status, run.stages)} />
      </div>
      <RunActions run={run} tenantId={tenantId} />
      <RunProgress stages={run.stages} onView={setTarget} />
      <RunLog history={run.history} stageNames={run.stages.map((s) => s.name)} />
      <OutputDialog
        runId={runId}
        tenantId={tenantId}
        target={target}
        stages={run.stages}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

function Body() {
  const { t } = useTranslation();
  const tenant = useProcessTenant();
  const refs = useEditorRefs(tenant.tenantId, tenant.ready);
  const found = useShowcaseDef(tenant.tenantId, tenant.ready && hubConfigured());
  const def = found.state === "ok" ? found.def : undefined;
  const starter = useShowcaseStart(def?.id, tenant.tenantId);
  const [error, setError] = useState<string | null>(null);
  const views: StageView[] = useMemo(
    () => (def ? stageViews(toDraft(def).stages, {}, refs) : []),
    [def, refs],
  );
  if (!hubConfigured()) return <HubNotConfigured />;
  const run = async (raw: Record<string, string>) => {
    if (!def) return;
    setError(null);
    try {
      await starter.start(toInputValues(def.inputs, raw));
    } catch (err) {
      const s = processErrorSpec(err);
      setError(t(s.key, s.params));
    }
  };
  return (
    <>
      <PageHeader title={t(`${K}title`)} description={t(`${K}subtitle`)} />
      {found.state === "loading" ? <LoadingState /> : null}
      {found.state === "error" ? (
        <HubLoadError message={t("process.common.error.load")} onRetry={found.retry} />
      ) : null}
      {found.state === "missing" ? (
        <Alert role="status">
          <AlertDescription>{t(`${K}missing`)}</AlertDescription>
        </Alert>
      ) : null}
      {def ? (
        <div className="space-y-4">
          <Panel title={t(`${K}canvas`)}>
            <CanvasView
              views={views}
              selected={undefined}
              readOnly
              ops={NOOP_OPS}
              onSelect={noop}
              onRemove={noop}
            />
          </Panel>
          <Panel title={t(`${K}try`)}>
            <ShowcaseInputs
              inputs={def.inputs}
              pending={starter.pending}
              error={error}
              onRun={(raw) => void run(raw)}
            />
          </Panel>
          {starter.runId ? (
            <Panel
              title={t(`${K}live`)}
              footer={
                <Button type="button" variant="outline" size="sm" onClick={starter.reset}>
                  {t(`${K}reset`)}
                </Button>
              }
            >
              <RunPanel runId={starter.runId} tenantId={tenant.tenantId} />
            </Panel>
          ) : null}
          <Panel title={t(`${K}swap.title`)}>
            <NodeSwapBox />
          </Panel>
        </div>
      ) : null}
    </>
  );
}

export function ShowcasePage() {
  return (
    <ProcessRouteGate>
      <Body />
    </ProcessRouteGate>
  );
}
