// ADM-FR-60, ADM-FR-61 · /tenants/$tenantId (mẫu B): header (tên, badge, khoá/mở khoá), tab Thông tin/Feature/Agent/Quota/Users.
import type { TenantDetail } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TIMEZONE_UNSUPPORTED_KEY } from "@/features/processes/domain/error-keys";
import { useSession } from "@/lib/auth/use-session";
import { describeError, validationIssues } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useTenantDetail } from "../api";
import { TenantQuotaTab } from "../components/quota/TenantQuotaTab";
import { TenantDefaultAppCard } from "../components/TenantDefaultAppCard";
import { TenantInfoForm } from "../components/TenantInfoForm";
import { TenantProfileCard } from "../components/TenantProfileCard";
import { TenantUsersTab, UnavailableTab } from "../components/TenantTabs";
import { useLockFlow } from "../hooks/use-lock-flow";
import { useTenantConflict } from "../hooks/use-tenant-conflict";
import { slotsToValue, type TenantInfoValues } from "../lib/schemas";
import { activeTab, TAB_LABEL, type TenantTab, visibleTabs } from "../lib/workspace-tabs";

const route = getRouteApi("/_authed/tenants/$tenantId");

export type { TenantTab } from "../lib/workspace-tabs";

/** P-d2 · tab "Tool quy trình" nạp lười (chỉ khi mở tab). */
const TenantToolsTab = lazy(() => import("../components/tools/TenantToolsTab"));
/** CR-111 · tab "Feature" (thẻ app: mức Tắt/Xem/Sửa/Quản trị + tính năng thêm) nạp lười. */
const TenantFeaturesTab = lazy(() => import("../components/features/TenantFeaturesTab"));
/** UAT B3 · tab "Gói" (bật/tắt gói nghiệp vụ, D-05 chỉ platform_admin) nạp lười. */
const TenantPacksTab = lazy(() => import("../components/packs/TenantPacksTab"));

function Header({
  tenant,
  canLock,
  onLock,
  onUnlock,
}: {
  tenant: TenantDetail;
  canLock: boolean;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(tenant.created_at).toLocaleDateString(
    i18n.language === "vi" ? "vi-VN" : "en-GB",
  );
  const noLock = tenant.key === "platform" || !canLock;
  return (
    <PageHeader
      title={tenant.name}
      description={`${t("tenants.detail.createdAt", { date })} · ${t("tenants.detail.userCount", { users: tenant.user_count })}`}
      actions={
        <>
          {tenant.status === "locked" ? (
            <StatusBadge tone="err">{t("tenants.status.locked")}</StatusBadge>
          ) : (
            <StatusBadge tone="ok">{t("tenants.status.active")}</StatusBadge>
          )}
          {noLock ? null : tenant.status === "locked" ? (
            <Button variant="outline" onClick={onUnlock}>
              {t("tenants.unlock.button")}
            </Button>
          ) : (
            <Button variant="destructive" onClick={onLock}>
              {t("tenants.lock.button")}
            </Button>
          )}
        </>
      }
    />
  );
}

export function TenantDetailPage() {
  const { t } = useTranslation();
  const tr = useTr();
  const { tenantId } = route.useParams();
  const { tab } = route.useSearch();
  const navigate = route.useNavigate();
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
        name: v.name,
        max_concurrent_sub: slotsToValue(v.slots),
        timezone: v.timezone,
        process_runs_max: Number(v.processRuns), // N2-FR-04
      },
      tenant.version,
    );
  };

  return (
    <>
      <Header
        tenant={tenant}
        canLock={isPlatform}
        onLock={() => requestLock(tenant)}
        onUnlock={() => requestUnlock(tenant)}
      />
      <Tabs
        value={activeTab(tab, isPlatform)}
        onValueChange={(v) => void navigate({ search: { tab: v as TenantTab }, replace: true })}
      >
        <TabsList>
          {visibleTabs(isPlatform).map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(TAB_LABEL[v])}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="info" className="pt-4">
          <TenantInfoForm
            readOnly={!isPlatform}
            tenant={tenant}
            pending={conflict.pending}
            timezoneError={tzError}
            onDirtyChange={setInfoDirty}
            onSubmit={save}
          />
          <TenantProfileCard profile={tenant.profile} />
          {isPlatform ? <TenantDefaultAppCard tenant={tenant} /> : null}
        </TabsContent>
        <TabsContent value="features" className="pt-4">
          <Suspense fallback={<LoadingState />}>
            <TenantFeaturesTab tenant={tenant} onDirtyChange={setFeaturesDirty} />
          </Suspense>
        </TabsContent>
        <TabsContent value="agents" className="pt-4">
          <UnavailableTab body="tenants.agents.unavailable" />
        </TabsContent>
        <TabsContent value="workflow-tools" className="pt-4">
          <Suspense fallback={<LoadingState />}>
            <TenantToolsTab tenant={tenant} />
          </Suspense>
        </TabsContent>
        <TabsContent value="packs" className="pt-4">
          <Suspense fallback={<LoadingState />}>
            <TenantPacksTab tenant={tenant} />
          </Suspense>
        </TabsContent>
        <TabsContent value="quota" className="pt-4">
          <TenantQuotaTab
            tenant={tenant}
            onDirtyChange={setQuotaDirty}
            onReloadTenant={reloadTenant}
          />
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          <TenantUsersTab tenant={tenant} />
        </TabsContent>
      </Tabs>
      <UnsavedGuard dirty={infoDirty || quotaDirty || featuresDirty} />
      {dialogs}
      <LazyConflictDialog props={conflict.props} />
    </>
  );
}
