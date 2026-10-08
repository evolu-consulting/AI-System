// HUB-FR-77 · HUB-FR-78 · CR-054 · /agents (Evolu Control → Agents): agent của công ty, ai được dùng, đúng một agent mặc định.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { HubLoadError, HubNotConfigured } from "@/components/shared/states/HubLoadError";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { hubConfigured } from "@/lib/hub";
import { AgentsTable } from "../components/AgentsTable";
import { GrantSheet } from "../components/GrantSheet";
import { useAgentActions } from "../hooks/use-agent-actions";
import { type AgentsView, useAgentsView } from "../hooks/use-agents-view";
import { useGrantSheet } from "../hooks/use-grant-sheet";
import { filterAgents } from "../lib/agents";

function AgentsBody({ v }: { v: AgentsView }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const data = v.settings.data;
  const all = data?.agents ?? [];
  const actions = useAgentActions(v.tenantId, all);
  const sheet = useGrantSheet(v.tenantId, v.grantTenantId);
  if (v.needsTenant) return <EmptyState message={t("common.tenantPicker.required")} />;
  if (v.settings.isError)
    return (
      <HubLoadError message={t("agents.loadError")} onRetry={() => void v.settings.refetch()} />
    );
  const rows = data ? filterAgents(all, q, i18n.language) : undefined;
  return (
    <section aria-labelledby="agents-list-h" className="space-y-3">
      {data && data.defaults === null ? (
        <Alert>
          <AlertDescription>{t("agents.noDefault")}</AlertDescription>
        </Alert>
      ) : null}
      {v.grants.isError ? (
        <HubLoadError message={t("agents.grantsError")} onRetry={() => void v.grants.refetch()} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="agents-list-h" className="text-h3 font-semibold">
          {t("agents.list.title")}
        </h2>
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("agents.list.search")}
          aria-label={t("agents.list.search")}
          className="w-60"
        />
      </div>
      <AgentsTable
        items={rows}
        defaults={data?.defaults ?? null}
        grantRows={v.grantRows}
        isPlatform={v.isPlatform}
        loading={v.settings.isPending}
        actions={actions}
        onGrant={(item) => sheet.show(item, v.grantRows.get(item.agent.id) ?? [])}
      />
      <p className="text-label text-muted-foreground">{t("agents.list.footnote")}</p>
      <GrantSheet s={sheet} />
    </section>
  );
}

export function AgentsPage() {
  const { t } = useTranslation();
  const v = useAgentsView();
  if (!v.me) return null;
  if (v.unknown) return <NotFoundState backTo="/agents" />;
  return (
    <>
      <PageHeader
        title={t("agents.title")}
        description={t("agents.subtitle")}
        actions={
          v.isPlatform ? (
            <TenantPicker tenants={v.tenants ?? []} value={v.tenantKey} onChange={v.setTenant} />
          ) : null
        }
      />
      {hubConfigured() ? <AgentsBody v={v} /> : <HubNotConfigured />}
    </>
  );
}
