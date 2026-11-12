// ADM-FR-66 · CR-056 · P-a F5: editor quy trình tối thiểu (`/processes/new`, `/processes/$processId`) — Cấu hình · Lượt chạy
// (plan-frontend-admin §1, board ②). `processId` vắng ⇒ tạo mới. Mẫu + tenant_admin ⇒ chỉ xem + "Chép mẫu".
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hubConfigured } from "@/lib/hub";
import { CompanyEditorBar } from "../components/editor/CompanyEditorBar";
import { DefInfoCard } from "../components/editor/DefInfoCard";
import { StagesFirst, TechCards } from "../components/editor/EditorCards";
import {
  blockedSteps,
  ConfigTab,
  CopySourceLine,
  EditorLoadFailure,
  FlowWrap,
  TemplateBanner,
} from "../components/editor/EditorParts";
import { EditorRunsTab } from "../components/editor/EditorRunsTab";
import { ProcessSaveBar } from "../components/editor/ProcessSaveBar";
import { LimitsCard } from "../components/editor/StagesCard";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { TestRunButton } from "../components/testrun/TestRunButton";
import { useDefSave } from "../hooks/use-def-save";
import { useDraft } from "../hooks/use-draft";
import { useEditorRefs } from "../hooks/use-editor-refs";
import { useApplyForDef, useFlowTrigger, useLoadedDef } from "../hooks/use-editor-state";
import { blockedReasons } from "../lib/blocked-reasons";
import {
  copyTenantId,
  infoVariant,
  isBusinessView,
  isCompanyOwned,
  usesStepForm,
} from "../lib/company-copy";
import { toInput, withLiveErrors } from "../lib/def-form";
import {
  catalogOf,
  isReadOnlyDef,
  libraryOf,
  prepareEnds,
  prepareFor,
  slotExtra,
} from "../lib/editor-prep";
import { eventOf } from "../lib/flow-def";
import { kindOf } from "../lib/node-summary";
import { endOutcomesOf } from "../lib/outline-ends";

/** `company` (CR-121 c17): mở từ Công ty › Quy trình của công ty đó ⇒ def thư viện hiện CHỈ XEM + "Sao chép cho công ty này". */
export type ProcessEditorPageProps = { processId?: string; company?: string | undefined };
const FORM_ID = "process-form";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 · U2b — cờ ẩn/hiện theo loại quy trình, tách ở đợt dọn sau
function Editor({ processId, company }: ProcessEditorPageProps) {
  const { t } = useTranslation();
  const d = useDraft();
  const { tenant, q, version, setVersion } = useLoadedDef(processId, d, company);
  const [formDirty, setFormDirty] = useState(false);
  const [runsView, setRunsView] = useState(false);
  const refs = useEditorRefs(tenant.tenantId, tenant.ready);
  const lib = libraryOf(q.data, tenant.isPlatform);
  // mẫu Thư viện không có công ty ⇒ không có danh mục tool theo công ty: bỏ kiểm "tool bật" ở máy khách (Hub kiểm bằng `libraryRefs` khi lưu)
  const tools = catalogOf(lib, refs.tools);
  // CR-122 · U1: flow có trigger = FlowDef mới; trigger sửa ở state riêng, gửi kèm khi Lưu.
  const ft = useFlowTrigger(q.data, d.dirty);
  const dirty = ft.dirty;
  const endsOf = endOutcomesOf(ft.src && ft.trig ? eventOf(ft.src.app, ft.trig.event) : undefined);
  // CR-123 FR-10: bản của công ty ⇒ lưu xong tự áp dụng (một nút), không còn Xuất bản/Bật riêng
  const ap = useApplyForDef(q.data, lib, processId);
  const save = useDefSave({
    afterSave: ap.afterSave,
    extra: { ...slotExtra(lib), ...ft.extra },
    prepare: ft.src ? prepareEnds(endsOf) : prepareFor(lib),
    id: processId,
    tenantId: tenant.tenantId,
    version,
    setVersion,
    d,
    teams: refs.teamSections,
    tools,
  });
  const errors = withLiveErrors(d.draft, d.errors, refs.teamSections, tools);
  const dv = { ...d, errors };
  const def = q.data;
  // CR-127: quy trình theo sự kiện chỉ admin nền tảng soạn; quản trị công ty chỉ xem (khoá công tắc, ẩn Lưu/Áp dụng — nếu không Lưu mới bị 403)
  const readOnly = isReadOnlyDef(def, tenant.isPlatform) || (!!ft.src && !tenant.isPlatform);
  if (!hubConfigured()) return <HubNotConfigured />;
  if (processId !== undefined && q.isError)
    return (
      <EditorLoadFailure
        error={q.error}
        onRetry={() => void q.refetch()}
        defId={processId}
        tenant={tenant}
      />
    );
  if (processId !== undefined && !def) return <LoadingState />;
  const business = isBusinessView(def, lib, tenant.isPlatform);
  // CR-127 · M2: quy trình CÔNG TY theo sự kiện ⇒ thanh trên thay PageHeader + hai tab + thẻ «Thông tin»
  const bar = !!ft.src && isCompanyOwned(def, lib) && !!tenant.tenantId && !!def;
  const form = (
    <form
      id={FORM_ID}
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.submit();
      }}
    >
      {readOnly && processId ? <TemplateBanner /> : null}
      {/* CR-123 u9: người dùng công ty chỉ thấy sơ đồ các bước ngay đầu trang; Nguồn / Thông tin đầu vào là khái niệm kỹ thuật ⇒ chỉ quản trị nền tảng */}
      <StagesFirst on={business} d={dv} readOnly={readOnly} refs={refs} />
      {bar ? null : (
        <DefInfoCard
          draft={d.draft}
          errors={errors}
          readOnly={readOnly}
          refs={refs}
          patch={d.patch}
          variant={infoVariant(def, lib)}
          hasAi={d.draft.stages.some((s) => kindOf(s) === "agent")}
          flow={!!ft.src}
        />
      )}
      <TechCards
        hide={business}
        d={d}
        dv={dv}
        readOnly={readOnly}
        refs={refs}
        tenantId={tenant.tenantId}
        ready={tenant.ready}
        flow={!!ft.src}
      />
      {ft.src ? null : <LimitsCard ttl={d.draft.ttl} noExpiry={d.draft.noExpiry} />}
      {readOnly ? null : (
        <ProcessSaveBar
          dirty={dirty}
          pending={save.pending}
          formId={FORM_ID}
          version={processId === undefined ? undefined : version}
          companyCopy={isCompanyOwned(def, lib)}
          apply={{ status: ap.status, needsApply: ap.needsApply }}
          applyLabel={bar}
          blockedSteps={blockedSteps(errors, d.draft.stages)}
          blockedCount={Object.keys(errors).length}
          blockedReasons={blockedReasons(errors, t)}
          testRun={
            ft.src && ft.trig && tenant.isPlatform && tenant.tenantId ? (
              <TestRunButton
                tenantId={tenant.tenantId}
                name={d.draft.name || def?.name || ""}
                event={eventOf(ft.src.app, ft.trig.event)}
                source={() => ({
                  draft: {
                    event: ft.trig?.event ?? null,
                    stages: toInput(prepareEnds(endsOf)(d.draft)).stages,
                  },
                })}
              />
            ) : undefined
          }
        />
      )}
    </form>
  );
  const config = (
    <FlowWrap ft={ft} def={def} lib={lib} d={d} readOnly={readOnly} tenantId={tenant.tenantId}>
      {form}
    </FlowWrap>
  );
  return (
    <>
      {bar && def && tenant.tenantId ? (
        <CompanyEditorBar
          name={d.draft.name}
          onName={(name) => d.patch({ name })}
          readOnly={readOnly}
          tenantId={tenant.tenantId}
          flowId={def.id}
          dirty={dirty}
          savedAt={q.dataUpdatedAt || undefined}
          runsOn={runsView}
          onRuns={() => setRunsView((v) => !v)}
        />
      ) : (
        <PageHeader title={def?.name ?? t("process.admin.editor.title.new")} />
      )}
      {bar ? null : (
        <CopySourceLine tenantId={copyTenantId(def)} sourceId={def?.source_template_id} />
      )}
      {bar && def ? (
        runsView ? (
          <EditorRunsTab processKey={def.key} tenantId={tenant.tenantId} />
        ) : (
          config
        )
      ) : processId === undefined || !def ? (
        config
      ) : (
        <Tabs defaultValue="config">
          <TabsList>
            <TabsTrigger value="config">{t("process.admin.editor.tab.config")}</TabsTrigger>
            <TabsTrigger value="runs">{t("process.admin.editor.tab.runs")}</TabsTrigger>
          </TabsList>
          <TabsContent value="config">
            <ConfigTab
              lib={lib}
              copy={usesStepForm(def, lib)}
              canvasDirty={dirty}
              formDirty={formDirty}
              onFormDirty={setFormDirty}
              config={config}
            />
          </TabsContent>
          <TabsContent value="runs">
            <EditorRunsTab processKey={def.key} tenantId={tenant.tenantId} />
          </TabsContent>
        </Tabs>
      )}
      <UnsavedGuard dirty={(d.dirty || formDirty || dirty) && !readOnly} />
      <LazyConflictDialog props={save.conflictProps} />
    </>
  );
}

export function ProcessEditorPage(props: ProcessEditorPageProps) {
  // CR-127 · Z6: không còn quy trình dùng chung gán cho công ty (chỉ-xem) ⇒ mọi quy trình mở ở đây là của chính công ty: vào thẳng trình sửa.
  return (
    <ProcessRouteGate>
      <Editor {...props} />
    </ProcessRouteGate>
  );
}
