// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-24 · editor Command (/commands/new, /commands/$id): 5 bước trong tab "Cấu hình" + tab "Ai dùng được".
import type { Command } from "@ai/contracts";
import { useRouter } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { EditorSaveBar } from "@/components/shared/EditorSaveBar";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useCommand, useCommandAccess } from "../api";
import { StepArgs } from "../components/StepArgs";
import { StepInputMap } from "../components/StepInputMap";
import { StepName } from "../components/StepName";
import { StepOutput } from "../components/StepOutput";
import { StepWorkflow } from "../components/StepWorkflow";
import { useCommandForm } from "../hooks/use-command-form";
import { useWorkflowLink } from "../hooks/use-workflow-link";
import { accessSummary } from "../lib/access";

// Tab ít dùng: tách chunk riêng để editor không kéo thêm bảng tenant (plan-frontend §6).
const AccessTab = lazy(() =>
  import("../components/AccessTab").then((m) => ({ default: m.AccessTab })),
);

export type CommandTab = "config" | "access";
type Props = {
  commandId?: string;
  from?: string;
  workflow?: string;
  tab: CommandTab;
  onTab: (tab: CommandTab) => void;
};
type BodyProps = Pick<Props, "tab" | "onTab"> & {
  command?: Command;
  copyOf?: Command;
  presetWorkflow?: string;
};

function EditorHeader({ command }: { command?: Command }) {
  const { t } = useTranslation();
  const router = useRouter();
  if (!command) return <PageHeader title={t("commands.editor.titleNew")} />;
  return (
    <>
      <PageHeader
        title={`/${command.name}`}
        description={command.aliases.length ? `alias ${command.aliases.join(", ")}` : undefined}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void router.navigate({ to: "/commands/new", search: { from: command.id } })
            }
          >
            {t("commands.header.duplicate")}
          </Button>
        }
      />
      <div className="-mt-3 mb-4 flex gap-2">
        <StatusBadge tone={command.enabled ? "ok" : "off"}>
          {t(command.enabled ? "common.on" : "common.off")}
        </StatusBadge>
      </div>
    </>
  );
}

function EditorBody({ command, copyOf, presetWorkflow, tab, onTab }: BodyProps) {
  const { t } = useTranslation();
  const ed = useCommandForm({ command, copyOf, presetWorkflow });
  const link = useWorkflowLink(ed.form, !command && !copyOf);
  const isDirty = ed.form.formState.isDirty;
  const tr = useTr();
  const access = useCommandAccess(command?.id, 0);
  const summary = access.data ? accessSummary(tr, access.data.total, access.data.items) : "";
  const serverNames = { name: ed.server.name, alias: ed.server.alias, feature: ed.server.feature };

  return (
    <FormProvider {...ed.form}>
      <form onSubmit={ed.form.handleSubmit((v) => ed.save(v, link.workflow))} noValidate>
        <EditorHeader command={command} />
        <Tabs value={command ? tab : "config"} onValueChange={(v) => onTab(v as CommandTab)}>
          <TabsList aria-label={t("commands.field.name")}>
            <TabsTrigger value="config">{t("commands.tab.config")}</TabsTrigger>
            <TabsTrigger value="access" disabled={!command}>
              {t("commands.tab.access")}
              {summary ? ` · ${summary}` : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="config" className="max-w-3xl space-y-4 pt-4">
            {copyOf ? (
              <Alert>
                <AlertDescription>
                  {t("commands.duplicate.hint", { name: copyOf.name })}
                </AlertDescription>
              </Alert>
            ) : null}
            <StepName excludeId={command?.id} serverErrors={serverNames} />
            <StepWorkflow
              onChange={(id) => void link.changeWorkflow(id)}
              notice={link.notice}
              disabledByServer={!!ed.server.workflowDisabled}
            />
            <StepArgs />
            <StepInputMap workflow={link.workflow} issues={ed.server.map} />
            <StepOutput />
          </TabsContent>
          {command ? (
            <TabsContent value="access" className="max-w-3xl pt-4">
              <Suspense fallback={<Skeleton className="h-40 w-full" />}>
                <AccessTab commandId={command.id} />
              </Suspense>
            </TabsContent>
          ) : null}
        </Tabs>
        <EditorSaveBar dirty={isDirty} pending={ed.pending} cancelTo="/commands" />
      </form>
      <UnsavedGuard dirty={isDirty} />
    </FormProvider>
  );
}

function useEditorSources({ commandId, from }: Props) {
  const command = useCommand(commandId);
  const copy = useCommand(from);
  return { command, copy };
}

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 404) return <NotFoundState backTo="/commands" />;
  return <ErrorState message={e?.message ?? ""} code={e?.code ?? "HTTP_ERROR"} onRetry={retry} />;
}

function EditorLoader(props: Props) {
  const { command, copy } = useEditorSources(props);
  const wanted = props.commandId ? command : props.from ? copy : null;
  if (wanted?.isPending) return <Skeleton className="h-96 w-full" />;
  if (wanted?.isError) return <Failed error={wanted.error} retry={() => void wanted.refetch()} />;
  const loaded = wanted?.data;
  return (
    <EditorBody
      key={props.commandId ? `${loaded?.id}-${loaded?.version}` : `new-${props.from ?? ""}`}
      command={props.commandId ? loaded : undefined}
      copyOf={props.commandId ? undefined : loaded}
      presetWorkflow={props.workflow}
      tab={props.tab}
      onTab={props.onTab}
    />
  );
}

export function CommandEditorPage(props: Props) {
  return (
    <PlatformOnly>
      <EditorLoader {...props} />
    </PlatformOnly>
  );
}
