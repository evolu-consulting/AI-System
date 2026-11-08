// ADM-FR-66 · CR-056 · P-a F5: editor quy trình tối thiểu (`/processes/new`, `/processes/$processId`) — Cấu hình · Lượt chạy
// (plan-frontend-admin §1, board ②). `processId` vắng ⇒ tạo mới. Mẫu + tenant_admin ⇒ chỉ xem + "Chép mẫu".
import type { FlowTrigger } from "@ai/contracts/hub-admin";
import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLibraryView } from "@/features/tenants/flows/api";
import { useSession } from "@/lib/auth/use-session";
import { ApiError } from "@/lib/http";
import { hubConfigured } from "@/lib/hub";
import { copyDef, useProcessDef } from "../api";
import { DefInfoCard } from "../components/editor/DefInfoCard";
import { StagesFirst, TechCards } from "../components/editor/EditorCards";
import { EditorRunsTab } from "../components/editor/EditorRunsTab";
import { ProcessSaveBar } from "../components/editor/ProcessSaveBar";
import { LimitsCard } from "../components/editor/StagesCard";
import { FlowEditorBody } from "../components/flow/FlowEditorBody";
import { CompanyCopyBody } from "../components/library/CompanyCopyBody";
import { LibraryEditorBody } from "../components/library/LibraryEditorBody";
import { LibraryReadOnlyView } from "../components/library/LibraryReadOnlyView";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { useApplyFlow } from "../hooks/use-apply-flow";
import { useDefSave } from "../hooks/use-def-save";
import { useDraft } from "../hooks/use-draft";
import { useEditorRefs } from "../hooks/use-editor-refs";
import { useProcessTenant } from "../hooks/use-process-tenant";
import {
  copyTenantId,
  infoVariant,
  isBusinessView,
  isCompanyFlow,
  isCompanyOwned,
  scopedTenantId,
  usesStepForm,
  viewerTenantId,
} from "../lib/company-copy";
import { type DefDraft, toDraft, withLiveErrors } from "../lib/def-form";
import { processErrorSpec } from "../lib/errors";
import { hasTrigger, healFlowInputs } from "../lib/flow-def";
import { notFoundBack } from "../lib/route-guard";
import { normalizeSlotStages } from "../lib/slot-canvas";
import type { LibraryDef } from "../library-api";

/** `company` (CR-121 c17): mở từ Công ty › Quy trình của công ty đó ⇒ def thư viện hiện CHỈ XEM + "Sao chép cho công ty này". */
export type ProcessEditorPageProps = { processId?: string; company?: string | undefined };
const FORM_ID = "process-form";

function useLoadedDef(
  processId: string | undefined,
  d: ReturnType<typeof useDraft>,
  company: string | undefined,
) {
  const picked = useProcessTenant();
  // platform_admin mở từ Công ty › Quy trình: công ty theo `?company=` (Hub cần tenant_id để đọc/lưu def của công ty).
  const tenantId = scopedTenantId(picked.isPlatform, picked.tenantId, company);
  const tenant = tenantId === picked.tenantId ? picked : { ...picked, tenantId, ready: true };
  const q = useProcessDef(processId, tenant.tenantId);
  const [version, setVersion] = useState(1);
  const loaded = useRef<string | null>(null);
  // CR-105: quy trình thư viện (có khe) nạp lại bản nháp mỗi khi `version` đổi (Form/Hub biên dịch lại `stages`); loại khác nạp một lần.
  const data: LibraryDef | undefined = q.data;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp một lần cho mỗi quy trình; làm tươi nền không đè bản đang sửa
  useEffect(() => {
    // thư viện + bản riêng sao từ thư viện (c17b: Form lưu slot_body ⇒ nạp lại theo version)
    const key = data?.slot || data?.source_template_id ? `${data.id}:${data.version}` : data?.id;
    if (data && loaded.current !== key) {
      loaded.current = key ?? null;
      // CR-122 p17 · flow theo sự kiện: input def luôn có khoá bản ghi của sự kiện (contract_id) để bộ chọn nguồn + kiểm đọc được.
      d.load(
        toDraft(hasTrigger(data) ? { ...data, inputs: healFlowInputs(data.inputs, data) } : data),
      );
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

/** CR-105 · tab Cấu hình: quy trình thư viện ⇒ thanh công cụ + Canvas|Form; còn lại ⇒ form cấu hình như cũ. */
function ConfigTab(p: {
  lib: LibraryDef | null;
  canvasDirty: boolean;
  formDirty: boolean;
  onFormDirty: (dirty: boolean) => void;
  config: React.ReactNode;
  copy: LibraryDef | null;
}) {
  if (!p.lib && p.copy)
    return <CompanyCopyBody def={p.copy} onFormDirty={p.onFormDirty} canvas={p.config} />;
  if (!p.lib) return <>{p.config}</>;
  return (
    <LibraryEditorBody
      def={p.lib}
      canvasDirty={p.canvasDirty}
      formDirty={p.formDirty}
      onFormDirty={p.onFormDirty}
      canvas={p.config}
    />
  );
}

function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 404) return <NotFoundState backTo={notFoundBack(role)} />;
  if (status === 403) return <ForbiddenState />;
  return <HubLoadError message={t("process.common.error.load")} onRetry={onRetry} />;
}

/** CR-105 · def có khe + người xem là platform_admin ⇒ editor thư viện (Canvas|Form, xuất bản, gán…). */
const libraryOf = (def: unknown, isPlatform: boolean): LibraryDef | null =>
  isPlatform &&
  ((def as LibraryDef | undefined)?.slot || hasTrigger(def)) &&
  !isCompanyFlow(def as LibraryDef | undefined) // CR-123 FR-10: bản của công ty không phải mẫu Thư viện ⇒ không có "Xuất bản"
    ? (def as LibraryDef)
    : null;
const isReadOnlyDef = (def: { is_template?: boolean } | undefined, isPlatform: boolean) =>
  !!def?.is_template && !isPlatform;
/** Canvas thư viện: chuẩn hoá dạng `s0 → route → s1..sn → finalize` trước khi kiểm + lưu (Hub `fromStages`). */
const prepareLibraryDraft = (d: DefDraft): DefDraft => ({
  ...d,
  stages: normalizeSlotStages(d.stages),
});
const prepareFor = (lib: LibraryDef | null) =>
  lib && !hasTrigger(lib) ? prepareLibraryDraft : undefined;
const slotExtra = (lib: LibraryDef | null) => (lib ? { slot: lib.slot } : undefined);

/** tenant_admin mở def thư viện: Hub ẩn (404) ⇒ thử đọc chỉ-xem theo công ty mình; không phải thư viện ⇒ NotFound. */
function EditorLoadFailure(p: {
  error: unknown;
  onRetry: () => void;
  defId: string;
  tenant: ReturnType<typeof useProcessTenant>;
}) {
  const failure = <LoadFailure error={p.error} onRetry={p.onRetry} />;
  const hidden = p.error instanceof ApiError && p.error.status === 404;
  const tid = viewerTenantId(p.tenant.isPlatform, p.tenant.tenantId, p.tenant.me?.tenant.id);
  if (hidden && tid && !p.tenant.isPlatform)
    return <LibraryReadOnlyView tenantId={tid} defId={p.defId} fallback={failure} />;
  return failure;
}

/** CR-122 · U1: flow có trigger = FlowDef mới; trigger sửa ở state riêng, gửi kèm khi Lưu. */
function useFlowTrigger(data: unknown, draftDirty: boolean) {
  const src = hasTrigger(data) ? data : null;
  const [edit, setEdit] = useState<FlowTrigger | null>(null);
  const trig = src ? (edit ?? src.trigger) : null;
  const dirty = draftDirty || (!!src && JSON.stringify(trig) !== JSON.stringify(src.trigger));
  const extra = src && trig ? { trigger: trig, app: src.app } : {};
  return { src, trig, setEdit, dirty, extra };
}

/** CR-123 FR-10: bản của công ty ⇒ lưu xong tự áp dụng (MỘT nút "Lưu và áp dụng"); loại khác không làm gì. */
function useApplyForDef(
  def: LibraryDef | undefined,
  lib: LibraryDef | null,
  id: string | undefined,
) {
  const ap = useApplyFlow(isCompanyOwned(def, lib) ? copyTenantId(def) : null, id);
  return { ...ap, afterSave: ap.active ? ap.apply : undefined };
}

function FlowWrap(p: {
  ft: ReturnType<typeof useFlowTrigger>;
  def: LibraryDef | undefined;
  lib: LibraryDef | null;
  d: ReturnType<typeof useDraft>;
  readOnly: boolean;
  tenantId: string | undefined;
  children: React.ReactNode;
}) {
  const { src, trig, setEdit } = p.ft;
  if (!src || !trig) return <>{p.children}</>;
  return (
    <FlowEditorBody
      meta={{
        key: p.def?.key ?? "",
        name: p.d.draft.name,
        app: src.app,
        owner: p.lib ? "library" : "company",
      }}
      trigger={trig}
      stages={p.d.draft.stages}
      readOnly={p.readOnly}
      tenantId={p.tenantId}
      draft={p.d.draft}
      onChange={(next, stages) => {
        setEdit(next);
        if (stages) p.d.patch({ stages });
      }}
    >
      {p.children}
    </FlowEditorBody>
  );
}
/** Danh mục tool để kiểm ở máy khách: mẫu Thư viện ⇒ vắng (không kiểm). */
const catalogOf = <T,>(lib: unknown, tools: T): T | undefined => (lib ? undefined : tools);

function Editor({ processId, company }: ProcessEditorPageProps) {
  const { t } = useTranslation();
  const d = useDraft();
  const { tenant, q, version, setVersion } = useLoadedDef(processId, d, company);
  const [formDirty, setFormDirty] = useState(false);
  const refs = useEditorRefs(tenant.tenantId, tenant.ready);
  const lib = libraryOf(q.data, tenant.isPlatform);
  // mẫu Thư viện không có công ty ⇒ không có danh mục tool theo công ty: bỏ kiểm "tool bật" ở máy khách (Hub kiểm bằng `libraryRefs` khi lưu)
  const tools = catalogOf(lib, refs.tools);
  // CR-122 · U1: flow có trigger = FlowDef mới; trigger sửa ở state riêng, gửi kèm khi Lưu.
  const ft = useFlowTrigger(q.data, d.dirty);
  const dirty = ft.dirty;
  // CR-123 FR-10: bản của công ty ⇒ lưu xong tự áp dụng (một nút), không còn Xuất bản/Bật riêng
  const ap = useApplyForDef(q.data, lib, processId);
  const save = useDefSave({
    afterSave: ap.afterSave,
    extra: { ...slotExtra(lib), ...ft.extra },
    prepare: prepareFor(lib),
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
  const readOnly = isReadOnlyDef(def, tenant.isPlatform);
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
      {readOnly && processId ? <TemplateBanner id={processId} tenantId={tenant.tenantId} /> : null}
      {/* CR-123 u9: người dùng công ty chỉ thấy sơ đồ các bước ngay đầu trang; Nguồn / Thông tin đầu vào là khái niệm kỹ thuật ⇒ chỉ quản trị nền tảng */}
      <StagesFirst on={business} d={dv} readOnly={readOnly} refs={refs} />
      <DefInfoCard
        draft={d.draft}
        errors={errors}
        readOnly={readOnly}
        refs={refs}
        patch={d.patch}
        variant={infoVariant(def, lib)}
      />
      <TechCards
        hide={business}
        d={d}
        dv={dv}
        readOnly={readOnly}
        refs={refs}
        tenantId={tenant.tenantId}
        ready={tenant.ready}
      />
      <LimitsCard ttl={d.draft.ttl} noExpiry={d.draft.noExpiry} />
      {readOnly ? null : (
        <ProcessSaveBar
          dirty={dirty}
          pending={save.pending}
          formId={FORM_ID}
          version={processId === undefined ? undefined : version}
          companyCopy={isCompanyOwned(def, lib)}
          apply={{ status: ap.status, needsApply: ap.needsApply }}
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
      <PageHeader title={def?.name ?? t("process.admin.editor.title.new")} />
      <CopySourceLine tenantId={copyTenantId(def)} sourceId={def?.source_template_id} />
      {processId === undefined || !def ? (
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

/** CR-121 c17 · "Sao từ thư viện: <bản gốc> · vN" của bản riêng công ty (vN = bản thư viện lúc sao). */
function CopySourceLine(p: { tenantId: string | undefined; sourceId: string | null | undefined }) {
  const { t } = useTranslation();
  const src = useLibraryView(p.tenantId ?? "", p.sourceId ?? null, !!p.tenantId && !!p.sourceId);
  if (!src.data) return null;
  return (
    <p className="text-caption text-muted-foreground" data-testid="copy-source">
      {t("process.admin.editor.copySource", {
        name: src.data.name,
        n: src.data.company_copy?.rel_version ?? src.data.rel_version,
      })}
    </p>
  );
}

export function ProcessEditorPage(props: ProcessEditorPageProps) {
  const { company, ...rest } = props;
  const withCompany = { ...rest, company };
  return (
    <ProcessRouteGate>
      {company && rest.processId ? (
        <LibraryReadOnlyView
          tenantId={company}
          defId={rest.processId}
          fallback={<Editor {...withCompany} />}
        />
      ) : (
        <Editor {...withCompany} />
      )}
    </ProcessRouteGate>
  );
}
