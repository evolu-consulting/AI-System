// ADM-FR-10, ADM-FR-11, ADM-FR-14, ADM-FR-15 · editor Workflow (/workflows/new, /workflows/$id): 4 tab, Info + Input chung một form và nút Lưu.
import type { Workflow } from "@ai/contracts";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { EditorSaveBar } from "@/components/shared/EditorSaveBar";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/http";
import { useSecretOptions, useWorkflow } from "../api";
import { SchemaBreaksAlert } from "../components/SchemaBreaksAlert";
import { SchemaEditor } from "../components/SchemaEditor";
import { ToolPreview } from "../components/ToolPreview";
import { WorkflowBlockedDialog } from "../components/WorkflowBlockedDialog";
import { WorkflowEditorHeader } from "../components/WorkflowEditorHeader";
import { WorkflowInfoSection } from "../components/WorkflowInfoSection";
import { WorkflowUsageTab } from "../components/WorkflowUsageTab";
import { useWorkflowEditor } from "../hooks/use-workflow-editor";

export type EditorTab = "info" | "input" | "preview" | "usage";
type Props = { workflowId?: string; tab: EditorTab; onTab: (tab: EditorTab) => void };

function ErrorDot() {
  return <span aria-hidden className="ml-1.5 inline-block size-2 rounded-full bg-destructive" />;
}

/** Tạo mới: chỉ có tab Thông tin (gồm cả Input) và "Model thấy gì"; sửa: đủ 4 tab. */
function EditorTabList({
  editing,
  infoErr,
  inputErr,
}: {
  editing: boolean;
  infoErr: boolean;
  inputErr: boolean;
}) {
  const { t } = useTranslation();
  return (
    <TabsList>
      <TabsTrigger value="info">
        {t("workflows.tab.info")}
        {infoErr ? <ErrorDot /> : null}
      </TabsTrigger>
      {editing ? (
        <TabsTrigger value="input">
          {t("workflows.tab.input")}
          {inputErr ? <ErrorDot /> : null}
        </TabsTrigger>
      ) : null}
      <TabsTrigger value="preview">{t("workflows.tab.preview")}</TabsTrigger>
      {editing ? <TabsTrigger value="usage">{t("workflows.tab.usage")}</TabsTrigger> : null}
    </TabsList>
  );
}

function EditorBody({ workflow, tab, onTab }: { workflow?: Workflow } & Omit<Props, "workflowId">) {
  const { t } = useTranslation();
  const secrets = useSecretOptions();
  const ed = useWorkflowEditor(workflow);
  const { errors, isDirty } = ed.form.formState;
  const editing = !!workflow;
  const active = !editing && (tab === "input" || tab === "usage") ? "info" : tab;

  return (
    <FormProvider {...ed.form}>
      <form onSubmit={ed.submit} noValidate>
        <WorkflowEditorHeader workflow={workflow} />
        <Tabs value={active} onValueChange={(v) => onTab(v as EditorTab)}>
          <EditorTabList
            editing={editing}
            infoErr={Object.keys(errors).some((k) => k !== "input_schema" || !editing)}
            inputErr={!!errors.input_schema}
          />
          <TabsContent value="info" className="pt-4">
            <WorkflowInfoSection mode={editing ? "edit" : "create"} secrets={secrets.data} />
            {editing ? null : (
              // Tạo mới: Input nằm cùng trang với Thông tin (một lượt khai báo); sau khi lưu mới tách tab.
              <div className="mt-8 space-y-3">
                <h2 className="text-label font-semibold">{t("workflows.schema.title")}</h2>
                <SchemaEditor />
              </div>
            )}
          </TabsContent>
          <TabsContent value="input" className="pt-4">
            <SchemaEditor />
          </TabsContent>
          <TabsContent value="preview" className="pt-4">
            <ToolPreview />
          </TabsContent>
          <TabsContent value="usage" className="pt-4">
            <WorkflowUsageTab workflowId={workflow?.id} />
          </TabsContent>
        </Tabs>
        {ed.breaks ? <SchemaBreaksAlert commands={ed.breaks.commands} /> : null}
        <EditorSaveBar dirty={isDirty} pending={ed.pending} cancelTo="/workflows" />
      </form>
      <UnsavedGuard dirty={isDirty} />
      <WorkflowBlockedDialog info={ed.blocked} onClose={ed.closeBlocked} />
    </FormProvider>
  );
}

function EditorLoader({ workflowId, tab, onTab }: Props) {
  const wf = useWorkflow(workflowId);
  if (!workflowId) return <EditorBody tab={tab} onTab={onTab} />;
  if (wf.isPending) return <Skeleton className="h-96 w-full" />;
  if (wf.isError) {
    const e = wf.error instanceof ApiError ? wf.error : null;
    if (e?.status === 404) return <NotFoundState backTo="/workflows" />;
    return (
      <ErrorState
        message={e?.message ?? ""}
        code={e?.code ?? "HTTP_ERROR"}
        onRetry={() => void wf.refetch()}
      />
    );
  }
  // `key` theo version: sau khi lưu/tải lại, form dựng lại từ dữ liệu mới (bỏ thay đổi đang sửa).
  return <EditorBody key={wf.data.version} workflow={wf.data} tab={tab} onTab={onTab} />;
}

export function WorkflowEditorPage(props: Props) {
  return (
    <PlatformOnly>
      <EditorLoader {...props} />
    </PlatformOnly>
  );
}
