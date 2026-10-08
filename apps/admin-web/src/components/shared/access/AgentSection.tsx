// ADM-FR-36 · ADM-FR-37 · nhóm "Agent" của AccessExplainer (plan-frontend §2.4): trình bày, KHÔNG fetch.
// Thấy trước rồi không thấy; mỗi dòng ✓/✕ + tên + lý do (grant) hoặc điều còn thiếu (missing).
import type { AgentMissing, EffectiveAgent } from "@ai/contracts/hub-admin";
import { Check, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";
import { HubLoadError, HubNotConfigured } from "../states/HubLoadError";

export type EffectiveAgentsState =
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; agents: EffectiveAgent[] };

const MISSING_KEY: Record<AgentMissing, string> = {
  user_inactive: "hub.effective.missing.userInactive",
  tenant_locked: "hub.effective.missing.tenantLocked",
  agent_disabled: "hub.effective.missing.agentDisabled",
  runtime_unavailable: "hub.effective.missing.runtimeUnavailable",
  no_entitlement: "hub.effective.missing.noEntitlement",
  no_grant: "hub.effective.missing.noGrant",
};

function useLines(a: EffectiveAgent, lang: string): string[] {
  const tr = useTr();
  if (!a.visible) return a.missing.map((m) => tr(MISSING_KEY[m]));
  return a.reasons.map((r) => {
    if (r.code === "grant_user") return tr("hub.effective.grantUser");
    if (r.code === "grant_tenant") return tr("hub.effective.grantTenant");
    return tr("hub.effective.grantGroup", { group: pickLocalized(r.group.name, lang) });
  });
}

function AgentLine({ agent, lang }: { agent: EffectiveAgent; lang: string }) {
  const { t } = useTranslation();
  const lines = useLines(agent, lang);
  const name = pickLocalized(agent.agent.name, lang);
  const Icon = agent.visible ? Check : X;
  return (
    <li className="flex flex-wrap items-center gap-x-2 text-body">
      <Icon
        role="img"
        aria-label={t(agent.visible ? "access.check.sees" : "access.check.notSees", { name })}
        className={agent.visible ? "size-4 text-success" : "size-4 text-danger"}
      />
      <span className="font-medium">{name}</span>
      <span className="font-mono text-label text-muted-foreground">{agent.agent.key}</span>
      {lines.map((l) => (
        <span key={l} className="text-muted-foreground">
          {l}
        </span>
      ))}
    </li>
  );
}

function AgentBody({ state, lang }: { state: EffectiveAgentsState; lang: string }) {
  const { t } = useTranslation();
  const sorted = useMemo(
    () =>
      state.status === "ready"
        ? [...state.agents].sort((a, b) => Number(b.visible) - Number(a.visible))
        : [],
    [state],
  );
  if (state.status === "unconfigured") return <HubNotConfigured />;
  if (state.status === "loading") {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-64" />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return <HubLoadError message={t("hub.effective.loadError")} onRetry={state.retry} />;
  }
  if (sorted.length === 0) {
    return <p className="text-body text-muted-foreground">{t("hub.effective.empty")}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {sorted.map((a) => (
        <AgentLine key={a.agent.id} agent={a} lang={lang} />
      ))}
    </ul>
  );
}

export function AgentSection({ state, lang }: { state: EffectiveAgentsState; lang: string }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="text-label font-semibold">{t("access.check.section.agents")}</h3>
      <AgentBody state={state} lang={lang} />
    </section>
  );
}
