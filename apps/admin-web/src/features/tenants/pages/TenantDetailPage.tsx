// ADM-FR-60, ADM-FR-61, ADM-FR-76 · workspace công ty /tenants/$tenantId (mẫu B): header (tên, badge, khoá/mở khoá) + tab theo `lib/workspace-tabs.ts`.
import type { TenantDetail } from "@ai/contracts/tenants";
import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TIMEZONE_UNSUPPORTED_KEY } from "@/features/processes/domain/error-keys";
import { useSession } from "@/lib/auth/use-session";
import { describeError, validationIssues } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { setLastTenant } from "@/lib/last-tenant";
import { useTr } from "@/lib/use-translate";
import { useTenantDetail } from "../api";
import { TenantProfileTab } from "../components/profile/TenantProfileTab";
import { useLockFlow } from "../hooks/use-lock-flow";
import { useTenantConflict } from "../hooks/use-tenant-conflict";
import { slotsToValue, type TenantInfoValues } from "../lib/schemas";
import { onboardAgainSearch } from "../lib/wizard";
import { WorkspaceProvider } from "../lib/workspace-context";
import { activeTab, TAB_LABEL, type TenantTab, visibleTabs } from "../lib/workspace-tabs";
import { MembersTab } from "../members/MembersTab";
import { SettingsTab } from "../settings/SettingsTab";

const route = getRouteApi("/_authed/tenants/$tenantId");

export type { TenantTab } from "../lib/workspace-tabs";

/** CR-112 · tab "Ứng dụng & Gói" (CR-111 thẻ app + gói nghiệp vụ, gộp) nạp lười. */
const TenantFeaturesTab = lazy(() => import("../components/features/TenantFeaturesTab"));
/** CR-121 c11 · tab "Quy trình" (R4): nơi duy nhất gán quy trình cho công ty. */
const CompanyFlowsTab = lazy(() => import("../flows/components/CompanyFlowsTab"));

function Header({
  tenant,
  onOnboard,
}: {
  tenant: TenantDetail;
  /** ADM-FR-79 · "Onboard lại": mở wizard từ bước 2 (chỉ platform_admin). */
  onOnboard?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={tenant.name}
      actions={
        <>
          {tenant.status === "locked" ? (
            <StatusBadge tone="err">{t("tenants.status.locked")}</StatusBadge>
          ) : (
            <StatusBadge tone="ok">{t("tenants.status.active")}</StatusBadge>
          )}
          {onOnboard && tenant.status !== "locked" ? (
            <Button variant="outline" onClick={onOnboard}>
              {t("tenants.wizard.onboardAgain")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

export function TenantDetailPage() {
  const { t } = useTranslation();
  const tr = useTr();
  const { tenantId } = route.useParams();
  const { tab, job, view, at } = route.useSearch();
  const navigate = route.useNavigate();
  const router = useRouter();
  const role = useSession((s) => s.me?.role);
  // CR-112 · ADM-FR-81: tenant_admin vào workspace công ty mình (API trả 404 với công ty khác), chỉ xem thông tin.
  const isPlatform = role === "platform_admin";
  const allowed = isPlatform || role === "tenant_admin";
  const query = useTenantDetail(tenantId, allowed);
  const [tzError, setTzError] = useState<string | undefined>();
  const conflict = useTenantConflict(tenantId, {
    onSaved: () => notifySuccess(t("tenants.toast.saved", { key: query.data?.key ?? "" })),
    onFail: (err) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      if (
        err instanceof ApiError &&
        err.code === "VALIDATION_ERROR" &&
        validationIssues(err.details).paths.includes("timezone")
      ) {
        setTzError(tr(TIMEZONE_UNSUPPORTED_KEY));
        return;
      }
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    },
    onReload: () => void query.refetch(),
  });
  const { requestLock, requestUnlock, dialogs } = useLockFlow();
  const [infoDirty, setInfoDirty] = useState(false);
  const [quotaDirty, setQuotaDirty] = useState(false);
  const [featuresDirty, setFeaturesDirty] = useState(false);
  const reloadTenant = useCallback(() => void query.refetch(), [query.refetch]);
  const loaded = query.data;
  const workspace = useMemo(() => (loaded ? { id: loaded.id, key: loaded.key } : null), [loaded]);
  // ADM-FR-76: nhớ công ty platform_admin đang mở — route cũ (`/users`…) chuyển tới đây.
  useEffect(() => {
    if (isPlatform && loaded?.id) setLastTenant(loaded.id);
  }, [isPlatform, loaded?.id]);

  if (!allowed) return <ForbiddenState />;
  if (query.isPending) return <LoadingState />;
  if (query.error) {
    const err = query.error instanceof ApiError ? query.error : null;
    if (err?.status === 404) return <NotFoundState backTo="/tenants" />;
    return (
      <ErrorState
        message={err?.message ?? ""}
        code={err?.code ?? "NETWORK_ERROR"}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const tenant = query.data;

  const save = (v: TenantInfoValues) => {
    setTzError(undefined);
    return conflict.save(
      {
        max_concurrent_sub: slotsToValue(v.slots),
        timezone: v.timezone,
        process_runs_max: Number(v.processRuns), // N2-FR-04
      },
      tenant.version,
    );
  };

  const current = activeTab(tab, isPlatform);

  return (
    <WorkspaceProvider value={workspace}>
      <Header
        tenant={tenant}
        onOnboard={
          isPlatform
            ? () =>
                void router.navigate({
                  to: "/tenants/new",
                  search: onboardAgainSearch(tenant.id),
                })
            : undefined
        }
      />
      <Tabs
        value={current}
        onValueChange={(v) => void navigate({ search: { tab: v as TenantTab }, replace: true })}
      >
        <TabsList className="h-auto flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
          {visibleTabs(isPlatform).map((v) => (
            <TabsTrigger key={v} value={v} className="h-8 flex-none">
              {t(TAB_LABEL[v])}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="profile" className="pt-4">
          <TenantProfileTab
            tenant={tenant}
            canEdit={isPlatform}
            onSaveName={(name) => conflict.save({ name }, tenant.version)}
          />
        </TabsContent>
        <TabsContent value="apps" className="pt-4">
          <Suspense fallback={<LoadingState />}>
            <TenantFeaturesTab tenant={tenant} onDirtyChange={setFeaturesDirty} />
          </Suspense>
        </TabsContent>
        <TabsContent value="processes" className="pt-4">
          <Suspense fallback={<LoadingState />}>
            <CompanyFlowsTab tenant={tenant} initialJob={job} />
          </Suspense>
        </TabsContent>
        <TabsContent value="members" className="pt-4">
          <MembersTab
            view={view ?? "users"}
            onView={(v) => void navigate({ search: { tab: "members", view: v }, replace: true })}
          />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <SettingsTab
            tenant={tenant}
            isPlatform={isPlatform}
            pending={conflict.pending}
            timezoneError={tzError}
            scrollToQuota={at === "quota"}
            onInfoDirty={setInfoDirty}
            onQuotaDirty={setQuotaDirty}
            onSubmit={save}
            onReloadTenant={reloadTenant}
            onLock={() => requestLock(tenant)}
            onUnlock={() => requestUnlock(tenant)}
          />
        </TabsContent>
      </Tabs>
      <UnsavedGuard dirty={infoDirty || quotaDirty || featuresDirty} />
      {dialogs}
      <LazyConflictDialog props={conflict.props} />
    </WorkspaceProvider>
  );
}
