// ADM-FR-30, ADM-FR-31, ADM-BR-10 · editor Feature (/features/new, /features/$id): tab Thông tin, Commands, Tenant + thanh lưu.
import type { FeatureDetail } from "@ai/contracts";
import { useState } from "react";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { EditorSaveBar } from "@/components/shared/EditorSaveBar";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useFeature } from "../api";
import { FeatureCommandsTab } from "../components/FeatureCommandsTab";
import { FeatureInfoTab } from "../components/FeatureInfoTab";
import { useFeatureForm } from "../hooks/use-feature-form";
import { removedOrphans } from "../lib/schemas";

export type FeatureTab = "info" | "commands" | "tenants";
type Props = { featureId?: string; tab: FeatureTab; onTab: (tab: FeatureTab) => void };

function EditorHeader({ feature }: { feature?: FeatureDetail }) {
  const { t, i18n } = useTranslation();
  if (!feature) return <PageHeader title={t("features.editor.titleNew")} />;
  return (
    <>
      <PageHeader title={pickLocalized(feature.name, i18n.language)} description={feature.key} />
      <div className="-mt-3 mb-4 flex gap-2">
        {feature.is_core ? <StatusBadge tone="info">{t("features.default")}</StatusBadge> : null}
        <StatusBadge tone={{ on: "ok", beta: "info", off: "off" }[feature.status] as "ok"}>
          {t(`features.status.${feature.status}`)}
        </StatusBadge>
      </div>
    </>
  );
}

type BodyProps = { feature?: FeatureDetail; onReload: () => void } & Omit<Props, "featureId">;

function EditorBody({ feature, tab, onTab, onReload }: BodyProps) {
  const { t } = useTranslation();
  const ed = useFeatureForm(feature, onReload);
  const isDirty = ed.form.formState.isDirty;
  const ids = ed.form.watch("command_ids");
  const blocked = ed.needsFeature && (!feature || removedOrphans(feature.commands, ids).length > 0);
  const active = !feature && tab === "tenants" ? "info" : tab;

  return (
    <FormProvider {...ed.form}>
      <form onSubmit={ed.form.handleSubmit(ed.save)} noValidate>
        <EditorHeader feature={feature} />
        <Tabs value={active} onValueChange={(v) => onTab(v as FeatureTab)}>
          <TabsList>
            <TabsTrigger value="info">{t("features.tab.info")}</TabsTrigger>
            <TabsTrigger value="commands">{t("features.tab.commands")}</TabsTrigger>
          </TabsList>
          <TabsContent value="info" className="pt-4">
            <FeatureInfoTab editing={!!feature} isCore={!!feature?.is_core} />
          </TabsContent>
          <TabsContent value="commands" className="pt-4">
            <FeatureCommandsTab feature={feature} />
          </TabsContent>
        </Tabs>
        <EditorSaveBar dirty={isDirty} pending={ed.pending} cancelTo="/features">
          {blocked ? (
            <span className="block text-destructive">{t("commands.error.featureRequired")}</span>
          ) : null}
        </EditorSaveBar>
      </form>
      <UnsavedGuard dirty={isDirty} />
    </FormProvider>
  );
}

function EditorLoader({ featureId, tab, onTab }: Props) {
  const f = useFeature(featureId);
  // Dựng lại form chỉ khi đổi feature hoặc người dùng bấm "Tải lại" (không theo version: refetch sau khi lưu không được xoá chỉnh sửa vừa gõ).
  const [epoch, setEpoch] = useState(0);
  const reload = () => void f.refetch().then(() => setEpoch((n) => n + 1));
  if (!featureId) return <EditorBody tab={tab} onTab={onTab} onReload={reload} />;
  if (f.isPending) return <Skeleton className="h-96 w-full" />;
  if (f.isError) {
    const e = f.error instanceof ApiError ? f.error : null;
    if (e?.status === 404) return <NotFoundState backTo="/features" />;
    return (
      <ErrorState
        message={e?.message ?? ""}
        code={e?.code ?? "HTTP_ERROR"}
        onRetry={() => void f.refetch()}
      />
    );
  }
  return (
    <EditorBody
      key={`${f.data.id}-${epoch}`}
      feature={f.data}
      tab={tab}
      onTab={onTab}
      onReload={reload}
    />
  );
}

export function FeatureEditorPage(props: Props) {
  return (
    <PlatformOnly>
      <EditorLoader {...props} />
    </PlatformOnly>
  );
}
