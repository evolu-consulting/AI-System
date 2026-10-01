// ADM-FR-60, ADM-FR-61 · /tenants/$tenantId (mẫu B): header (tên, badge, khoá/mở khoá), tab Thông tin/Feature/Agent/Quota/Users.
import type { TenantDetail } from "@ai/contracts";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
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
import { useSession } from "@/lib/auth/use-session";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useTenantDetail } from "../api";
import { TenantInfoForm } from "../components/TenantInfoForm";
import { TenantUsersTab, UnavailableTab } from "../components/TenantTabs";
import { useLockFlow } from "../hooks/use-lock-flow";
import { useTenantConflict } from "../hooks/use-tenant-conflict";
import { slotsToValue, type TenantInfoValues } from "../lib/schemas";

const route = getRouteApi("/_authed/tenants/$tenantId");

function Header({
  tenant,
  onLock,
  onUnlock,
}: {
  tenant: TenantDetail;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(tenant.created_at).toLocaleDateString(
    i18n.language === "vi" ? "vi-VN" : "en-GB",
  );
  const isPlatform = tenant.key === "platform";
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
          {isPlatform ? null : tenant.status === "locked" ? (
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
  const role = useSession((s) => s.me?.role);
  const allowed = role === "platform_admin";
  const query = useTenantDetail(tenantId, allowed);
  const conflict = useTenantConflict(tenantId, {
    onSaved: () => notifySuccess(t("tenants.toast.saved", { key: query.data?.key ?? "" })),
    onFail: (err) => {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err);
      notifyError(tr(spec.key, spec.params));
    },
    onReload: () => void query.refetch(),
  });
  const { requestLock, requestUnlock, dialogs } = useLockFlow();
  const [dirty, setDirty] = useState(false);

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

  const save = (v: TenantInfoValues) =>
    conflict.save({ name: v.name, max_concurrent_sub: slotsToValue(v.slots) }, tenant.version);

  return (
    <>
      <Header
        tenant={tenant}
        onLock={() => requestLock(tenant)}
        onUnlock={() => requestUnlock(tenant)}
      />
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">{t("tenants.tab.info")}</TabsTrigger>
          <TabsTrigger value="features">{t("tenants.tab.features")}</TabsTrigger>
          <TabsTrigger value="agents">{t("tenants.tab.agents")}</TabsTrigger>
          <TabsTrigger value="quota">{t("tenants.tab.quota")}</TabsTrigger>
          <TabsTrigger value="users">{t("tenants.tab.users")}</TabsTrigger>
        </TabsList>
        <TabsContent value="info" className="pt-4">
          <TenantInfoForm
            tenant={tenant}
            pending={conflict.pending}
            onDirtyChange={setDirty}
            onSubmit={save}
          />
        </TabsContent>
        <TabsContent value="features" className="pt-4">
          <UnavailableTab body="tenants.tab.unavailableBody" />
        </TabsContent>
        <TabsContent value="agents" className="pt-4">
          <UnavailableTab body="tenants.agents.unavailable" />
        </TabsContent>
        <TabsContent value="quota" className="pt-4">
          <UnavailableTab body="tenants.tab.unavailableBody" />
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          <TenantUsersTab tenant={tenant} />
        </TabsContent>
      </Tabs>
      <UnsavedGuard dirty={dirty} />
      {dialogs}
      <LazyConflictDialog props={conflict.props} />
    </>
  );
}
