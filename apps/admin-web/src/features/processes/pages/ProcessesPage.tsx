// ADM-FR-65 · CR-056 · P-a F5: `/processes` — danh sách quy trình, tab "Của công ty" / "Mẫu" (plan-frontend-admin §1, board ①).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/http";
import { hubConfigured } from "@/lib/hub";
import { ProcessesTable } from "../components/ProcessesTable";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { RunDialog } from "../components/RunDialog";
import {
  type ProcessesView,
  type StateFilter,
  type Tab,
  useProcessesView,
} from "../hooks/use-processes-view";

function Body({ v }: { v: ProcessesView }) {
  const { t } = useTranslation();
  const err = v.q.error;
  if (err instanceof ApiError && err.status === 403) return <ForbiddenState />;
  const chips = (["all", "on", "off"] as const).map((value) => ({
    value,
    label: t(`process.admin.list.filter.${value}`),
  }));
  const emptyKey = v.templates ? "emptyTemplates" : "empty";
  return (
    <div className="space-y-3">
      {v.templates ? null : (
        <FilterChips
          label={t("process.admin.list.col.enabled")}
          chips={chips}
          value={v.filter}
          onChange={(f: StateFilter) => v.setFilter(f)}
        />
      )}
      <ProcessesTable
        rows={v.rows}
        templates={v.templates}
        library={v.library}
        canWrite={v.canWrite}
        canRun={v.canRun}
        loading={v.q.isPending}
        fetching={v.q.isFetching}
        error={
          err
            ? { message: err.message, code: err instanceof ApiError ? String(err.code) : "" }
            : null
        }
        onRetry={() => void v.q.refetch()}
        empty={<EmptyState message={t(`process.admin.list.${emptyKey}`)} />}
        actions={v.actions}
      />
      {v.q.hasNextPage ? (
        <Button
          variant="outline"
          disabled={v.q.isFetchingNextPage}
          onClick={() => void v.q.fetchNextPage()}
        >
          {t("process.admin.list.more")}
        </Button>
      ) : null}
    </div>
  );
}

function ListPage() {
  const { t } = useTranslation();
  const v = useProcessesView();
  if (!v.tenant.me) return null;
  const libraryTab = v.tenant.isPlatform && !v.tenant.tenantId;
  return (
    <>
      <PageHeader
        title={t("process.admin.list.title")}
        description={t("process.admin.list.subtitle")}
        actions={
          <>
            {v.tenant.isPlatform ? (
              <TenantPicker
                tenants={v.tenant.tenants ?? []}
                value={v.tenant.tenantKey}
                onChange={v.tenant.setTenant}
              />
            ) : null}
            {v.canWrite ? (
              <Button asChild>
                <Link to="/processes/new">{t("process.admin.list.create")}</Link>
              </Button>
            ) : null}
          </>
        }
      />
      {hubConfigured() ? (
        <Tabs value={v.tab} onValueChange={(x) => v.setTab(x as Tab)}>
          <TabsList>
            <TabsTrigger value="own">
              {t(libraryTab ? "process.admin.library.tab.own" : "process.admin.list.tab.own")}
            </TabsTrigger>
            <TabsTrigger value="templates">{t("process.admin.list.tab.templates")}</TabsTrigger>
          </TabsList>
          <TabsContent value="own">{v.tab === "own" ? <Body v={v} /> : null}</TabsContent>
          <TabsContent value="templates">
            {v.tab === "templates" ? <Body v={v} /> : null}
          </TabsContent>
        </Tabs>
      ) : (
        <HubNotConfigured />
      )}
      <RunDialog row={v.runRow} tenantId={v.tenant.tenantId} onClose={v.closeRun} />
      <ConfirmDialog
        open={v.delRow !== null}
        onOpenChange={(o) => !o && v.closeDelete()}
        title={t("process.admin.list.delete.title")}
        description={t("process.admin.list.delete.body", { name: v.delRow?.name ?? "" })}
        confirmLabel={t("process.admin.list.deleteButton")}
        destructive
        level="heavy"
        confirmText={v.delRow?.name}
        typePrompt={t("process.admin.list.delete.prompt")}
        onConfirm={v.confirmDelete}
      />
      <LazyConflictDialog props={v.conflictProps} />
    </>
  );
}

export function ProcessesPage() {
  return (
    <ProcessRouteGate>
      <ListPage />
    </ProcessRouteGate>
  );
}
