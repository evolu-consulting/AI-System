// ADM-FR-66 · CR-056 · P-a F5: editor quy trình tối thiểu (`/processes/new`, `/processes/$processId`) — Cấu hình · Lượt chạy
// (plan-frontend-admin §1, board ②). `processId` vắng ⇒ tạo mới. Mẫu + tenant_admin ⇒ chỉ xem + "Chép mẫu".
import type { ProcessDef } from "@ai/contracts/hub-admin";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/http";
import { hubConfigured } from "@/lib/hub";
import { copyDef, useProcessDef } from "../api";
import { DefInfoCard } from "../components/editor/DefInfoCard";
import { EditorRunsTab } from "../components/editor/EditorRunsTab";
import { InputsCard } from "../components/editor/InputsCard";
import { ProcessSaveBar } from "../components/editor/ProcessSaveBar";
import { SourcesCard } from "../components/editor/SourcesCard";
import { LimitsCard, StagesCard } from "../components/editor/StagesCard";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { useDefSave } from "../hooks/use-def-save";
import { useDraft } from "../hooks/use-draft";
import { useEditorRefs } from "../hooks/use-editor-refs";
import { useProcessTenant } from "../hooks/use-process-tenant";
import { toDraft } from "../lib/def-form";
import { processErrorSpec } from "../lib/errors";

export type ProcessEditorPageProps = { processId?: string };
const FORM_ID = "process-form";

function useLoadedDef(processId: string | undefined, d: ReturnType<typeof useDraft>) {
  const tenant = useProcessTenant();
  const q = useProcessDef(processId, tenant.tenantId);
  const [version, setVersion] = useState(1);
  const loaded = useRef<string | null>(null);
  const data: ProcessDef | undefined = q.data;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp một lần cho mỗi quy trình; làm tươi nền không đè bản đang sửa
  useEffect(() => {
    if (data && loaded.current !== data.id) {
      loaded.current = data.id;
      d.load(toDraft(data));
      setVersion(data.version);
    }
  }, [data]);
  return { tenant, q, version, setVersion };
}

function TemplateBanner({ id, tenantId }: { id: string; tenantId: string | undefined }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const copy = () =>
    void copyDef(id, tenantId).then(
      (res) => {
        notifySuccess(t("process.admin.list.toast.copied"));
        void navigate({ to: "/processes/$processId", params: { processId: res.id } });
      },
      (err) => {
        const s = processErrorSpec(err);
        notifyError(t(s.key, s.params));
      },
    );
  return (
    <Alert className="flex items-center gap-3">
      <AlertDescription className="flex-1">{t("process.admin.editor.readonly")}</AlertDescription>
      <Button type="button" onClick={copy}>
        {t("process.admin.list.copy")}
      </Button>
    </Alert>
  );
}

function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 404) return <NotFoundState backTo="/processes" />;
  if (status === 403) return <ForbiddenState />;
  return <HubLoadError message={t("process.common.error.load")} onRetry={onRetry} />;
}

function Editor({ processId }: ProcessEditorPageProps) {
  const { t } = useTranslation();
  const d = useDraft();
  const { tenant, q, version, setVersion } = useLoadedDef(processId, d);
  const refs = useEditorRefs(tenant.tenantId, tenant.ready);
  const save = useDefSave({ id: processId, tenantId: tenant.tenantId, version, setVersion, d });
  const def = q.data;
  const readOnly = !!def?.is_template && !tenant.isPlatform;
  if (!hubConfigured()) return <HubNotConfigured />;
  if (processId !== undefined && q.isError)
    return <LoadFailure error={q.error} onRetry={() => void q.refetch()} />;
  if (processId !== undefined && !def) return <LoadingState />;
  const config = (
    <form
      id={FORM_ID}
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.submit();
      }}
    >
      {readOnly && processId ? <TemplateBanner id={processId} tenantId={tenant.tenantId} /> : null}
      <DefInfoCard
        draft={d.draft}
        errors={d.errors}
        readOnly={readOnly}
        refs={refs}
        patch={d.patch}
      />
      <SourcesCard
        draft={d.draft}
        errors={d.errors}
        readOnly={readOnly}
        tenantId={tenant.tenantId}
        ready={tenant.ready}
        patch={d.patch}
      />
      <InputsCard draft={d.draft} errors={d.errors} readOnly={readOnly} patch={d.patch} />
      <StagesCard d={d} readOnly={readOnly} refs={refs} />
      <LimitsCard />
      {readOnly ? null : (
        <ProcessSaveBar
          dirty={d.dirty}
          pending={save.pending}
          formId={FORM_ID}
          version={processId === undefined ? undefined : version}
        />
      )}
    </form>
  );
  return (
    <>
      <PageHeader title={def?.name ?? t("process.admin.editor.title.new")} />
      {processId === undefined || !def ? (
        config
      ) : (
        <Tabs defaultValue="config">
          <TabsList>
            <TabsTrigger value="config">{t("process.admin.editor.tab.config")}</TabsTrigger>
            <TabsTrigger value="runs">{t("process.admin.editor.tab.runs")}</TabsTrigger>
          </TabsList>
          <TabsContent value="config">{config}</TabsContent>
          <TabsContent value="runs">
            <EditorRunsTab processKey={def.key} tenantId={tenant.tenantId} />
          </TabsContent>
        </Tabs>
      )}
      <UnsavedGuard dirty={d.dirty && !readOnly} />
      <LazyConflictDialog props={save.conflictProps} />
    </>
  );
}

export function ProcessEditorPage(props: ProcessEditorPageProps) {
  return (
    <ProcessRouteGate>
      <Editor {...props} />
    </ProcessRouteGate>
  );
}
