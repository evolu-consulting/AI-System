// CR-118 · cr118-app-config · /apps/$appKey (chỉ platform_admin): trang cấu hình MỘT app — "app này bật cho ai, chạy quy trình nào".
// CR-121 c13: 3 tab Tổng quan · Tính năng · Xem trước. Gán quy trình KHÔNG làm ở đây — chỉ link sang Công ty › Quy trình (AssignNote).
import type { AppCreateRequest } from "@ai/contracts/app-catalog";
import { getAppManifest, type PreviewRole } from "@ai/contracts/app-manifest";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/http";
import { loadError } from "@/lib/load-error";
import { useAppList, useUpdateApp } from "../api";
import { AppFormDialog } from "../components/AppFormDialog";
import { AssignNote } from "../components/AssignNote";
import { FeaturesTab } from "../components/tabs/FeaturesTab";
import { OverviewTab } from "../components/tabs/OverviewTab";
import { PreviewTab } from "../components/tabs/PreviewTab";
import { useAppCompanies } from "../hooks/use-app-companies";
import { useAppProcesses } from "../hooks/use-app-processes";
import {
  APP_TABS,
  type AppTab,
  configWarnings,
  enabledCount,
  featureAppOf,
} from "../lib/app-config";

type Props = { appKey: string; tab: AppTab; onTab: (t: AppTab) => void; notice?: boolean };

function Content({ appKey, tab, onTab, notice }: Props) {
  const { t } = useTranslation();
  const list = useAppList(true);
  const update = useUpdateApp();
  const appId = featureAppOf(appKey);
  const manifest = getAppManifest(appKey);
  const companies = useAppCompanies(appId);
  const processes = useAppProcesses(appKey);
  const [editing, setEditing] = useState(false);
  const [previewTenant, setPreviewTenant] = useState<string | undefined>();
  const [role, setRole] = useState<PreviewRole>("member");
  const app = list.data?.items.find((a) => a.key === appKey);
  const warnings = useMemo(
    () =>
      app
        ? configWarnings({
            app,
            rows: companies.rows,
            assigned: processes.assigned,
            slots: manifest?.slots ?? [],
          })
        : [],
    [app, companies.rows, processes.assigned, manifest],
  );
  const err = loadError(list.error);
  if (err)
    return <ErrorState message={err.message} code={err.code} onRetry={() => void list.refetch()} />;
  if (list.isPending) return <LoadingState />;
  if (!app) return <NotFoundState backTo="/apps" />;

  const save = async (v: AppCreateRequest) => {
    try {
      const { key: _k, ...body } = v;
      await update.mutateAsync({ key: app.key, body });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      return code === "VALIDATION_ERROR" ? ("invalid" as const) : ("generic" as const);
    }
    notifySuccess(t("apps.toast.saved", { name: v.name.vi }));
    return null;
  };
  return (
    <>
      <PageHeader
        title={app.name.vi}
        description={t("appcfg.subtitle")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/apps">{t("appcfg.back")}</Link>
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              {t("appcfg.edit")}
            </Button>
          </>
        }
      />
      <p className="-mt-4 mb-4 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        {appId ? (
          <StatusBadge tone="info">
            {t("appcfg.overview.enabledOf", {
              on: enabledCount(companies.rows),
              total: companies.rows.length,
            })}
          </StatusBadge>
        ) : null}
        <span className="font-mono">{app.url || t("appcfg.overview.noUrl")}</span>
        <span>· {t(app.sso ? "appcfg.overview.ssoOn" : "appcfg.overview.ssoOff")}</span>
      </p>
      <AssignNote rows={companies.rows} highlight={!!notice} />
      <Tabs value={tab} onValueChange={(v) => onTab(v as AppTab)}>
        <TabsList aria-label={t("appcfg.tabs")}>
          {APP_TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`appcfg.tab.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <OverviewTab
            app={app}
            appId={appId}
            rows={companies.rows}
            slotCount={processes.views.length}
            warnings={warnings}
            onEdit={() => setEditing(true)}
          />
        </TabsContent>
        <TabsContent value="features" className="pt-4">
          <FeaturesTab appId={appId} />
        </TabsContent>
        <TabsContent value="preview" className="pt-4">
          <PreviewTab
            manifest={manifest}
            rows={companies.rows}
            tenantId={previewTenant}
            onTenant={setPreviewTenant}
            draft={null}
            role={role}
            onRole={setRole}
            version="saved"
            onVersion={() => {}}
          />
        </TabsContent>
      </Tabs>
      {editing ? (
        <AppFormDialog initial={app} onClose={() => setEditing(false)} onSubmit={save} />
      ) : null}
    </>
  );
}

export function AppDetailPage(props: Props) {
  return (
    <PlatformOnly>
      <Content {...props} />
    </PlatformOnly>
  );
}
