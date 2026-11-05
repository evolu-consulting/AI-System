// HUB-FR-77 · HUB-FR-78 · CR-054 · /agents (Evolu Control → Agents): agent của công ty, ai được dùng, đúng một agent mặc định.
import type { AgentSettingsItem } from "@ai/contracts/hub-admin";
import type { TFunction } from "i18next";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { ListEmpty, ListPage } from "@/components/shared/list/ListPage";
import { applyFilters, type FilterGroup, isFiltered } from "@/components/shared/list/list-filter";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { hubConfigured } from "@/lib/hub";
import { useAgentMonthUsage, useMyApps } from "../api";
import { AgentDrawer } from "../components/AgentDrawer";
import { AgentsTable } from "../components/AgentsTable";
import { BackgroundAgentsTable } from "../components/BackgroundAgentsTable";
import { GrantSheet } from "../components/GrantSheet";
import { type AgentActions, useAgentActions } from "../hooks/use-agent-actions";
import { type AgentsView, useAgentsView } from "../hooks/use-agents-view";
import { useGrantSheet } from "../hooks/use-grant-sheet";
import { filterAgents, isActive } from "../lib/agents";
import { splitBySurface, usageByAgent } from "../lib/background";

/** Mục 2 "Agent chạy nền của app": ẩn khi công ty không có agent nền nào; usage tháng này lấy từ Usage analytics. */
function BackgroundSection(p: {
  items: AgentSettingsItem[] | undefined;
  actions: AgentActions;
  v: AgentsView;
  hasAny: boolean;
}) {
  const { t } = useTranslation();
  const usage = useAgentMonthUsage(p.v.tenantId, p.hasAny && p.v.isPlatform);
  const apps = useMyApps(p.hasAny);
  if (p.items && !p.hasAny) return null;
  return (
    <div className="space-y-3 pt-4">
      <div>
        <h2 id="agents-bg-h" className="text-h3 font-semibold">
          {t("agents.bg.title")}
        </h2>
        <p className="text-label text-muted-foreground">{t("agents.bg.subtitle")}</p>
      </div>
      <BackgroundAgentsTable
        items={p.items}
        actions={p.actions}
        isPlatform={p.v.isPlatform}
        loading={p.items === undefined}
        usage={{
          available: p.v.isPlatform,
          loading: usage.isPending,
          failed: usage.isError,
          byAgent: usageByAgent(usage.data?.tree ?? []),
        }}
        tenantKey={p.v.tenantKey ?? null}
        apps={apps.data ?? []}
      />
    </div>
  );
}

function agentFilterGroups(t: TFunction, status: string | undefined): FilterGroup[] {
  return [
    {
      id: "status",
      label: t("agents.col.entitled"),
      value: status,
      options: [
        { value: "on", label: t("common.on") },
        { value: "off", label: t("common.off") },
      ],
    },
  ];
}

function visibleAgents(
  chat: AgentSettingsItem[],
  q: string,
  lang: string,
  groups: FilterGroup[],
): AgentSettingsItem[] {
  return applyFilters(filterAgents(chat, q, lang), groups, (a) => (isActive(a) ? "on" : "off"));
}

function AgentsBody({ v }: { v: AgentsView }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | null>(null);
  const data = v.settings.data;
  const all = data?.agents ?? [];
  const actions = useAgentActions(v.tenantId, all);
  const sheet = useGrantSheet(v.tenantId, v.grantTenantId);
  const { chat, background } = splitBySurface(all, data?.defaults?.default_agent_id ?? null);
  const groups = agentFilterGroups(t, status);
  const clear = () => {
    setQ("");
    setStatus(undefined);
  };
  const rows = data ? visibleAgents(chat, q, i18n.language, groups) : undefined;
  const opened = chat.find((a) => a.agent.id === openId) ?? null;
  const frame = (children: ReactNode) => (
    <ListPage
      title={t("agents.title")}
      description={t("agents.subtitle")}
      count={data ? chat.length : undefined}
      extra={
        v.isPlatform ? (
          <TenantPicker tenants={v.tenants ?? []} value={v.tenantKey} onChange={v.setTenant} />
        ) : null
      }
      groups={groups}
      onChange={(_id, val) => setStatus(val)}
      onClear={clear}
      search={<SearchBox label={t("agents.list.search")} value={q} onChange={setQ} />}
      shown={rows?.length}
      total={data ? chat.length : undefined}
    >
      {children}
    </ListPage>
  );
  if (v.needsTenant) return frame(<EmptyState message={t("common.tenantPicker.required")} />);
  if (v.settings.isError)
    return frame(
      <HubLoadError message={t("agents.loadError")} onRetry={() => void v.settings.refetch()} />,
    );
  return frame(
    <section aria-label={t("agents.list.title")} className="space-y-3">
      {data && data.defaults === null ? (
        <Alert>
          <AlertDescription>{t("agents.noDefault")}</AlertDescription>
        </Alert>
      ) : null}
      {v.grants.isError ? (
        <HubLoadError message={t("agents.grantsError")} onRetry={() => void v.grants.refetch()} />
      ) : null}
      <AgentsTable
        all={all}
        items={rows}
        defaults={data?.defaults ?? null}
        grantRows={v.grantRows}
        isPlatform={v.isPlatform}
        loading={v.settings.isPending}
        actions={actions}
        onGrant={(item) => sheet.show(item, v.grantRows.get(item.agent.id) ?? [])}
        onOpen={(item) => setOpenId(item.agent.id)}
        activeId={openId}
        empty={
          isFiltered(groups, q) ? (
            <ListEmpty what={t("agents.list.what")} onClear={clear} />
          ) : undefined
        }
      />
      <p className="text-label text-muted-foreground">{t("agents.list.footnote")}</p>
      <BackgroundSection
        items={data ? background : undefined}
        actions={actions}
        v={v}
        hasAny={background.length > 0}
      />
      <AgentDrawer
        item={opened}
        rows={opened ? (v.grantRows.get(opened.agent.id) ?? []) : []}
        entitled={opened ? actions.entitledOf(opened) : false}
        onClose={() => setOpenId(null)}
      />
      <GrantSheet s={sheet} />
    </section>,
  );
}
export function AgentsPage() {
  const { t } = useTranslation();
  const v = useAgentsView();
  if (!v.me) return null;
  if (v.unknown) return <NotFoundState backTo="/agents" />;
  if (hubConfigured()) return <AgentsBody v={v} />;
  return (
    <>
      <PageHeader title={t("agents.title")} description={t("agents.subtitle")} />
      <HubNotConfigured />
    </>
  );
}
