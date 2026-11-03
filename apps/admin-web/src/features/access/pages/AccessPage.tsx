// ADM-FR-35 · ADM-FR-36 · M3-R13 · tab Phân quyền của workspace công ty (CR-112): 2 tab con Ma trận · Kiểm tra quyền; tenant theo workspace.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { UnsavedGuard } from "@/components/shared/UnsavedGuard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RolesPanel } from "@/features/app-roles/components/RolesPanel";
import { useSession } from "@/lib/auth/use-session";
import { CheckTab } from "../components/check/CheckTab";
import { MatrixTab } from "../components/matrix/MatrixTab";
import { type AccessTab, useAccessView } from "../hooks/use-access-view";

export function AccessPage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const view = useAccessView(me);
  const [rolesDirty, setRolesDirty] = useState(false);
  if (!me) return null;
  return (
    <>
      <PageHeader title={t("access.title")} description={t("access.subtitle")} />
      <Tabs value={view.tab} onValueChange={(v) => view.setTab(v as AccessTab)}>
        <TabsList>
          <TabsTrigger value="roles">{t("access.tab.roles")}</TabsTrigger>
          <TabsTrigger value="matrix">{t("access.tab.matrix")}</TabsTrigger>
          <TabsTrigger value="check">{t("access.tab.check")}</TabsTrigger>
        </TabsList>
        <TabsContent value="roles" className="pt-4">
          {view.needsTenant ? (
            <EmptyState message={t("access.selectTenant")} />
          ) : (
            <RolesPanel
              key={view.tenantId ?? "self"}
              tenantId={view.tenantId}
              onDirtyChange={setRolesDirty}
            />
          )}
        </TabsContent>
        <TabsContent value="matrix" className="pt-4">
          {view.needsTenant ? (
            <EmptyState message={t("access.selectTenant")} />
          ) : (
            <MatrixTab
              key={view.tenantId ?? "self"}
              tenantId={view.tenantId}
              tenantKey={view.tenantKey}
            />
          )}
        </TabsContent>
        <TabsContent value="check" className="pt-4">
          {view.needsTenant ? (
            <EmptyState message={t("access.selectTenant")} />
          ) : (
            <CheckTab
              tenantId={view.tenantId}
              isPlatform={view.isPlatform}
              username={view.user}
              onUser={view.setUser}
            />
          )}
        </TabsContent>
      </Tabs>
      <UnsavedGuard dirty={rolesDirty} />
    </>
  );
}
