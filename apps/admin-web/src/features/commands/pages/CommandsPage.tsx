// ADM-FR-20 · /commands (mẫu A, missing-screens §2): bộ lọc trên URL, bảng phân trang server 50 dòng, công tắc, xoá, nhân bản.
import { getRouteApi, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { COMMANDS_PAGE_SIZE, useCommandList, useWorkflowOptions } from "../api";
import { CommandFilters } from "../components/CommandFilters";
import { CommandTable } from "../components/CommandTable";
import { useCommandActions } from "../hooks/use-command-actions";
import { useCommandsNav } from "../hooks/use-commands-nav";

const route = getRouteApi("/_authed/commands/");

function CommandsEmpty({
  filtered,
  q,
  onClear,
}: {
  filtered: boolean;
  q?: string;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const workflows = useWorkflowOptions();
  if (filtered) {
    return (
      <EmptyState
        message={q ? t("state.empty.noResults", { q }) : t("state.empty.noMatch")}
        action={
          <Button variant="outline" onClick={onClear}>
            {t("common.clearFilters")}
          </Button>
        }
      />
    );
  }
  const noWorkflow = workflows.data?.total === 0;
  return (
    <EmptyState
      message={t("commands.empty.text")}
      action={
        <Button asChild>
          {noWorkflow ? (
            <Link to="/workflows/new">{t("commands.empty.noWorkflow")}</Link>
          ) : (
            <Link to="/commands/new">{t("commands.empty.cta")}</Link>
          )}
        </Button>
      }
    />
  );
}

function CommandsContent() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const patch = useCommandsNav();
  const actions = useCommandActions();
  const page = search.page ?? 1;
  const list = useCommandList(
    {
      q: search.q ?? "",
      status: search.status,
      feature: search.feature,
      workflow: search.workflow,
      offset: (page - 1) * COMMANDS_PAGE_SIZE,
    },
    true,
  );
  const err = list.error instanceof ApiError ? list.error : null;
  const filtered = !!(search.q || search.status || search.feature || search.workflow);

  return (
    <>
      <PageHeader
        title={t("commands.list.title")}
        description={t("commands.list.subtitle")}
        actions={
          <Button asChild>
            <Link to="/commands/new">{t("commands.list.create")}</Link>
          </Button>
        }
      />
      <CommandFilters
        status={search.status ?? "all"}
        feature={search.feature}
        workflow={search.workflow}
        q={search.q ?? ""}
        counts={list.data?.counts}
        onStatus={(s) => patch({ status: s === "all" ? undefined : s })}
        onFeature={(feature) => patch({ feature })}
        onWorkflow={(workflow) => patch({ workflow })}
        onQuery={(q) => patch({ q: q || undefined })}
      />
      <CommandTable
        commands={list.data?.items}
        optimistic={actions.optimistic}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={
          <CommandsEmpty
            filtered={filtered}
            q={search.q}
            onClear={() =>
              patch({ q: undefined, status: undefined, feature: undefined, workflow: undefined })
            }
          />
        }
        onToggle={actions.toggle}
        onDelete={actions.remove}
      />
      <div className="mt-4">
        <Pagination
          offset={(page - 1) * COMMANDS_PAGE_SIZE}
          limit={COMMANDS_PAGE_SIZE}
          total={list.data?.total ?? 0}
          onOffsetChange={(o) => patch({ page: o / COMMANDS_PAGE_SIZE + 1 }, true)}
        />
      </div>
      {actions.dialog}
    </>
  );
}

/** Chỉ `platform_admin`: vai khác thấy ForbiddenState và không gọi API (hooks nằm trong `CommandsContent`). */
export function CommandsPage() {
  return (
    <PlatformOnly>
      <CommandsContent />
    </PlatformOnly>
  );
}
