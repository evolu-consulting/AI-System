// ADM-FR-14 · /workflows (canvas Workflows): hướng dẫn 3 bước, chip có số, ô tìm, bảng phân trang server 50 dòng, hành động hàng.
import { getRouteApi, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useWorkflowList, WORKFLOWS_PAGE_SIZE } from "../api";
import { WorkflowFilters } from "../components/list/WorkflowFilters";
import { WorkflowGuide } from "../components/list/WorkflowGuide";
import { WorkflowTable } from "../components/list/WorkflowTable";
import { useWorkflowActions } from "../hooks/use-workflow-actions";
import { useWorkflowsNav } from "../hooks/use-workflows-nav";

const route = getRouteApi("/_authed/workflows/");

function WorkflowsContent() {
  const { t } = useTranslation();
  const tr = useTr();
  const search = route.useSearch();
  const patch = useWorkflowsNav();
  const actions = useWorkflowActions();
  const page = search.page ?? 1;
  const list = useWorkflowList(
    {
      q: search.q ?? "",
      status: search.status,
      secret: search.secret,
      offset: (page - 1) * WORKFLOWS_PAGE_SIZE,
    },
    true,
  );
  const err = list.error instanceof ApiError ? list.error : null;
  const filtered = !!search.q || !!search.status || !!search.secret;
  const create = (
    <Button asChild>
      <Link to="/workflows/new">{t("workflows.list.create")}</Link>
    </Button>
  );
  const clear = () => patch({ q: undefined, status: undefined, secret: undefined });

  return (
    <>
      <PageHeader
        title={t("workflows.list.title")}
        description={t("workflows.list.subtitle")}
        actions={create}
      />
      <WorkflowGuide />
      <WorkflowFilters
        status={search.status ?? "all"}
        q={search.q ?? ""}
        secret={search.secret}
        counts={list.data?.counts}
        onStatus={(s) => patch({ status: s === "all" ? undefined : s })}
        onQuery={(q) => patch({ q: q || undefined })}
        onClearSecret={() => patch({ secret: undefined })}
      />
      <WorkflowTable
        workflows={list.data?.items}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={
          filtered ? (
            <EmptyState
              message={
                search.q ? tr("state.empty.noResults", { q: search.q }) : t("state.empty.noMatch")
              }
              action={
                <Button variant="outline" onClick={clear}>
                  {t("common.clearFilters")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              message={t("workflows.empty.text")}
              action={
                <Button asChild>
                  <Link to="/workflows/new">{t("workflows.empty.cta")}</Link>
                </Button>
              }
            />
          )
        }
        onToggle={actions.toggle}
        onDelete={actions.remove}
      />
      <div className="mt-4">
        <Pagination
          offset={(page - 1) * WORKFLOWS_PAGE_SIZE}
          limit={WORKFLOWS_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => patch({ page: o / WORKFLOWS_PAGE_SIZE + 1 }, true)}
        />
      </div>
      {actions.dialogs}
    </>
  );
}

/** Chỉ `platform_admin`: vai khác thấy ForbiddenState và không gọi API (hooks nằm trong `WorkflowsContent`). */
export function WorkflowsPage() {
  return (
    <PlatformOnly>
      <WorkflowsContent />
    </PlatformOnly>
  );
}
