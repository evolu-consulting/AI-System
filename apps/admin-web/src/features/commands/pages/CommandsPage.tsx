// ADM-FR-20 · /commands (mẫu A, missing-screens §2): bộ lọc trên URL, bảng phân trang server 50 dòng, công tắc, xoá, nhân bản.
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { ListEmpty, ListPage } from "@/components/shared/list/ListPage";
import { Pagination } from "@/components/shared/Pagination";
import { PlatformOnly } from "@/components/shared/PlatformOnly";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { COMMANDS_PAGE_SIZE, useCommandList, useWorkflowOptions } from "../api";
import { CommandDrawer } from "../components/list/CommandDrawer";
import { CommandTable } from "../components/list/CommandTable";
import { useCommandFilterGroups } from "../components/list/command-filter-groups";
import { useCommandActions } from "../hooks/use-command-actions";
import { useCommandsNav } from "../hooks/use-commands-nav";

const route = getRouteApi("/_authed/commands/");

function CommandsEmpty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  const { t } = useTranslation();
  const workflows = useWorkflowOptions();
  if (filtered) return <ListEmpty what={t("commands.list.what")} onClear={onClear} />;
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

  const groups = useCommandFilterGroups(search, list.data?.counts);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = list.data?.items.find((c) => c.id === openId) ?? null;
  const clear = () =>
    patch({ q: undefined, status: undefined, feature: undefined, workflow: undefined });

  return (
    <ListPage
      title={t("commands.list.title")}
      description={t("commands.list.subtitle")}
      count={list.data?.counts?.all}
      primary={
        <Button asChild>
          <Link to="/commands/new">{t("commands.list.create")}</Link>
        </Button>
      }
      groups={groups}
      onChange={(id, v) => patch({ [id]: v })}
      onClear={clear}
      search={
        <SearchBox
          label={t("commands.list.search")}
          value={search.q ?? ""}
          onChange={(q) => patch({ q: q || undefined })}
        />
      }
      shown={list.data?.total}
      total={list.data?.counts?.all}
    >
      <CommandTable
        commands={list.data?.items}
        optimistic={actions.optimistic}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={err ? { message: err.message, code: err.code } : null}
        onRetry={() => void list.refetch()}
        empty={<CommandsEmpty filtered={filtered} onClear={clear} />}
        onToggle={actions.toggle}
        onDelete={actions.remove}
        onOpen={(c) => setOpenId(c.id)}
        activeId={openId}
      />
      <Pagination
        offset={(page - 1) * COMMANDS_PAGE_SIZE}
        limit={COMMANDS_PAGE_SIZE}
        total={list.data?.total ?? 0}
        onOffsetChange={(o) => patch({ page: o / COMMANDS_PAGE_SIZE + 1 }, true)}
      />
      <CommandDrawer command={opened} onClose={() => setOpenId(null)} />
      {actions.dialog}
    </ListPage>
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
