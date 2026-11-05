import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { AutomationNote } from "@/components/shared/AutomationNote";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/http";
import { hubConfigured } from "@/lib/hub";
import { useTr } from "@/lib/use-translate";
import { CloneDialog } from "../components/library/CloneDialog";
import { ProcessesHeader } from "../components/ProcessesHeader";
import { ProcessesTable } from "../components/ProcessesTable";
import { ProcessRouteGate } from "../components/ProcessRouteGate";
import { RunDialog } from "../components/RunDialog";
import { useFlowsList } from "../hooks/use-flows-list";
import {
  type ProcessesView,
  type StateFilter,
  type Tab,
  useProcessesView,
} from "../hooks/use-processes-view";

/** CR-120 · MỘT trang Quy trình của công ty (nạp lười: không vào chunk đầu). */
const FlowsList = lazy(
  () => import(/* webpackChunkName: "flows-one-page" */ "../components/flows/FlowsList"),
);
const CreateDialog = lazy(() => import("../components/flows/CreateDialog"));

/** CR-118 · đang lọc theo app (link từ trang cấu hình app): nói rõ + lối về trang app + bỏ lọc. */
function AppFilterNotice({ app, onClear }: { app: string; onClear: () => void }) {
  const { t } = useTranslation();
  const tr = useTr();
  const name = tr(`featmeta.app.${app}.name`, { defaultValue: app });
  return (
    <p
      role="note"
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-caption"
    >
      {t("appcfg.listFilter", { app: name })}
      <Button variant="link" size="sm" className="h-auto p-0" asChild>
        <Link to="/apps/$appKey" params={{ appKey: app }} search={{ tab: "processes" }}>
          {t("appcfg.openApp")}
        </Link>
      </Button>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onClear}>
        {t("appcfg.listFilterClear")}
      </Button>
    </p>
  );
}

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
      {v.app ? <AppFilterNotice app={v.app} onClear={v.clearApp} /> : null}
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
        canEditTemplates={v.canEditTemplates}
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

/** Thư viện platform (chưa chọn công ty): giữ hai tab Thư viện / Mẫu · chạy thử như cũ. */
function LibraryTabs({ v }: { v: ProcessesView }) {
  const { t } = useTranslation();
  return (
    <Tabs value={v.tab} onValueChange={(x) => v.setTab(x as Tab)}>
      <TabsList>
        <TabsTrigger value="own">{t("process.admin.library.tab.own")}</TabsTrigger>
        <TabsTrigger value="templates">{t("process.admin.list.tab.templates")}</TabsTrigger>
      </TabsList>
      <TabsContent value="own">{v.tab === "own" ? <Body v={v} /> : null}</TabsContent>
      <TabsContent value="templates">{v.tab === "templates" ? <Body v={v} /> : null}</TabsContent>
    </Tabs>
  );
}

function ListPage() {
  const { t } = useTranslation();
  const v = useProcessesView();
  // tenant đang xem (platform: tenant đã chọn; tenant_admin: tenant của phiên); thư viện platform ⇒ rỗng.
  const tid = v.tenant.me ? (v.tenant.isPlatform ? v.tenant.tenantId : v.tenant.me.tenant.id) : "";
  const hub = hubConfigured();
  const flows = useFlowsList(
    tid ?? "",
    v.tenant.tenantId,
    v.tenant.isPlatform,
    v.flowsMode && !!tid && hub,
  );
  if (!v.tenant.me) return null;
  return (
    <>
      <ProcessesHeader v={v} />
      {v.flowsMode ? null : <AutomationNote kind="processes" showLink={v.tenant.isPlatform} />}
      {!hub ? (
        <HubNotConfigured />
      ) : v.flowsMode ? (
        <Suspense fallback={null}>
          <FlowsList
            tid={tid ?? ""}
            flows={flows}
            actions={v.actions}
            canRun={v.canRun}
            canEditRules={!v.tenant.isPlatform}
          />
          {v.createOpen ? (
            <CreateDialog
              open
              onOpenChange={v.setCreateOpen}
              templates={flows.templates}
              actions={v.actions}
            />
          ) : null}
        </Suspense>
      ) : (
        <LibraryTabs v={v} />
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
      <CloneDialog
        src={v.cloneFlow.src}
        pending={v.cloneFlow.pending}
        error={v.cloneFlow.error}
        onSubmit={(n) => void v.cloneFlow.submit(n)}
        onClose={v.cloneFlow.close}
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
