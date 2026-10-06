// ADM-FR-37 · CR-043 · tab Agent của group (plan-frontend §2.3): bảng agent từ Hub + công tắc "Cấp {agent} cho {group}".

import type { Group } from "@ai/contracts";
import type { AgentGrantListItem } from "@ai/contracts/hub-admin";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { Switch } from "@/components/ui/switch";
import { hubConfigured } from "@/lib/hub";
import { pickLocalized } from "@/lib/localized";
import { useGroupAgents } from "../../hooks/use-group-agents";

type Tab = ReturnType<typeof useGroupAgents>;

function useColumns(group: Group, tab: Tab): Column<AgentGrantListItem>[] {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return useMemo(
    () => [
      {
        id: "agent",
        header: t("groups.agents.col.agent"),
        cell: (row) => (
          <div className="flex flex-col">
            <span className="font-medium">{pickLocalized(row.agent.name, lang)}</span>
            <span className="font-mono text-label text-muted-foreground">{row.agent.key}</span>
          </div>
        ),
      },
      {
        id: "status",
        header: t("groups.agents.col.status"),
        cell: (row) => (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={row.agent.enabled ? "ok" : "off"}>
              {t(row.agent.enabled ? "common.on" : "common.off")}
            </StatusBadge>
            {row.agent.runnable ? null : (
              <StatusBadge tone="warn">{t("groups.agents.notRunnable")}</StatusBadge>
            )}
          </div>
        ),
      },
      {
        id: "grant",
        header: t("groups.agents.col.grant"),
        cell: (row) => (
          <Switch
            checked={tab.isGranted(row)}
            disabled={tab.isPending(row.agent.id)}
            onCheckedChange={(v) => void tab.toggle(row, v)}
            aria-label={t("groups.agents.grantLabel", {
              agent: pickLocalized(row.agent.name, lang),
              group: pickLocalized(group.name, lang),
            })}
          />
        ),
      },
    ],
    [t, lang, group.name, tab],
  );
}

function AgentTable({ group }: { group: Group }) {
  const { t } = useTranslation();
  const tab = useGroupAgents(group);
  const columns = useColumns(group, tab);
  const { query } = tab;
  if (query.isError) {
    return (
      <HubLoadError message={t("groups.agents.loadError")} onRetry={() => void query.refetch()} />
    );
  }
  return (
    <div className="space-y-2">
      <DataTable
        caption={t("groups.agents.caption")}
        columns={columns}
        rows={query.data?.items}
        getRowKey={(row) => row.agent.id}
        isLoading={query.isPending}
        empty={<EmptyState message={t("groups.agents.empty")} />}
        skeletonRows={3}
      />
      {query.data?.truncated ? (
        <p className="text-label text-muted-foreground">{t("groups.agents.truncated")}</p>
      ) : null}
    </div>
  );
}

export function AgentTab({ group }: { group: Group }) {
  return hubConfigured() ? <AgentTable group={group} /> : <HubNotConfigured />;
}
