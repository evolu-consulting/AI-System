// ADM-FR-35 · ADM-FR-36 · M3-R13 · /access (canvas Access): 2 tab Ma trận · Kiểm tra quyền; platform chọn tenant (`?tenant=`), D9.
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth/use-session";
import { CheckTab } from "../components/check/CheckTab";
import { MatrixTab } from "../components/matrix/MatrixTab";
import { type AccessTab, useAccessView } from "../hooks/use-access-view";

export function AccessPage() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const view = useAccessView(me);
  if (!me) return null;
  if (view.unknown) return <NotFoundState backTo="/" />;
  return (
    <>
      <PageHeader title={t("access.title")} description={t("access.subtitle")} />
      {view.isPlatform ? (
        <div className="mb-4">
          <TenantPicker
            tenants={view.tenants ?? []}
            value={view.tenantKey}
            onChange={view.setTenant}
          />
        </div>
      ) : null}
      <Tabs value={view.tab} onValueChange={(v) => view.setTab(v as AccessTab)}>
        <TabsList>
          <TabsTrigger value="matrix">{t("access.tab.matrix")}</TabsTrigger>
          <TabsTrigger value="check">{t("access.tab.check")}</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix" className="pt-4">
          {view.needsTenant ? (
            <EmptyState message={t("access.selectTenant")} />
          ) : (
            <MatrixTab tenantId={view.tenantId} tenantKey={view.tenantKey} />
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
    </>
  );
}
