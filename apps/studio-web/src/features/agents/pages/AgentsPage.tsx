// HUB-FR-60 · HUB-FR-62 · H4a-R06, R08, R11 · màn Agents (Main): banner, tìm/lọc trên URL, bảng, trạng thái tải/rỗng/lỗi.
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "#/components/shared/EmptyState";
import { ErrorState } from "#/components/shared/ErrorState";
import { HrefLink } from "#/components/shared/HrefLink";
import { PageHeader } from "#/components/shared/PageHeader";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button, buttonVariants } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { AgentFilters } from "../components/list/AgentFilters";
import type { RowActions } from "../components/list/AgentRow";
import { AgentTable } from "../components/list/AgentTable";
import { AttentionBanner } from "../components/list/AttentionBanner";
import { useAgentFilters } from "../hooks/use-agent-filters";
import { useAgentList } from "../hooks/use-agent-list";
import { useDeleteAgent } from "../hooks/use-delete-agent";
import { useSetOrchestrator } from "../hooks/use-set-orchestrator";
import { useToggleAgent } from "../hooks/use-toggle-agent";
import { hasFilters } from "../lib/filters";
import { enabledButNotGranted } from "../lib/status";

const apiCode = (e: unknown) => (e as { code?: unknown } | null)?.code;

type ListBodyProps = {
  list: ReturnType<typeof useAgentList>;
  filtered: boolean;
  onClear: () => void;
  locale: "vi" | "en";
  actions: RowActions;
};

function ListBody({ list, filtered, onClear, locale, actions }: ListBodyProps) {
  const { t } = useTranslation();
  if (list.error)
    return (
      <ErrorState code={String(apiCode(list.error) ?? "") || undefined} onRetry={list.refetch} />
    );
  if (list.isPending)
    return (
      <div aria-busy="true" className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: dòng skeleton tĩnh
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  if (list.items.length > 0)
    return <AgentTable items={list.items} overlaps={list.overlaps} locale={locale} {...actions} />;
  if (!filtered && list.all.length === 0)
    return (
      <EmptyState
        message={t("agents.empty")}
        action={
          <HrefLink path="/agents/new" className={buttonVariants()}>
            {t("agents.createFirst")}
          </HrefLink>
        }
      />
    );
  return (
    <EmptyState
      message={t("agents.noMatch")}
      action={
        <Button variant="outline" onClick={onClear}>
          {t("agents.clearFilters")}
        </Button>
      }
    />
  );
}

export function AgentsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "vi";
  const f = useAgentFilters();
  const list = useAgentList(f.filters, f.serverFilters);
  const { toggle } = useToggleAgent();
  const { setOrchestrator } = useSetOrchestrator();
  const { remove } = useDeleteAgent();

  const create = (
    <HrefLink path="/agents/new" className={buttonVariants()}>
      {t("agents.create")}
    </HrefLink>
  );
  return (
    <>
      <PageHeader title={t("agents.title")} subtitle={t("agents.subtitle")} actions={create} />
      <div className="space-y-4">
        <AttentionBanner agents={enabledButNotGranted(list.all)} />
        {list.truncated ? (
          <Alert className="border-transparent bg-warning-bg text-warning">
            <Info aria-hidden />
            <AlertDescription className="text-warning">{t("agents.truncated")}</AlertDescription>
          </Alert>
        ) : null}
        <AgentFilters
          filters={f.filters}
          onQuery={f.setQ}
          onRuntime={f.setRuntime}
          onStatus={f.setStatus}
        />
        <ListBody
          list={list}
          filtered={hasFilters(f.filters)}
          onClear={f.clear}
          locale={locale}
          actions={{
            onToggle: (a) => toggle(a, locale),
            onSetOrchestrator: (a) => setOrchestrator({ agentId: a.id, name: a.name[locale] }),
            onDelete: (a) => remove({ id: a.id, key: a.key, version: a.version }),
          }}
        />
      </div>
    </>
  );
}
