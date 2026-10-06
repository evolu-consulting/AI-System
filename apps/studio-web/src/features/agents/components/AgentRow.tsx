// HUB-FR-60 · H4a-R06, R08, R11 · một dòng bảng agent: tên + key, runtime, profile, số workflow/tenant, badge, công tắc, menu ⋯.
import type { AgentListItem, SimilarAgent } from "@ai/contracts/studio";
import { useTranslation } from "react-i18next";
import { HrefLink } from "#/components/shared/HrefLink";
import { Badge } from "#/components/ui/badge";
import { Switch } from "#/components/ui/switch";
import { TableCell, TableRow } from "#/components/ui/table";
import { isOrchestrator } from "../lib/status";
import { AgentRowMenu } from "./AgentRowMenu";

export type RowActions = {
  onToggle: (a: AgentListItem) => void;
  onSetOrchestrator: (a: AgentListItem) => void;
  onDelete: (a: AgentListItem) => void;
};
type Props = { agent: AgentListItem; locale: "vi" | "en"; overlap?: SimilarAgent[] } & RowActions;

function Badges({ agent, overlap }: { agent: AgentListItem; overlap?: SimilarAgent[] }) {
  const { t } = useTranslation();
  const tenants = agent.orchestrator_of.tenant_ids.length;
  return (
    <>
      {agent.orchestrator_of.default ? (
        <Badge variant="info">{t("agents.badge.orch")}</Badge>
      ) : null}
      {!agent.orchestrator_of.default && tenants > 0 ? (
        <Badge variant="info">{t("agents.badge.orchTenants", { n: tenants })}</Badge>
      ) : null}
      {overlap ? (
        <Badge variant="warn" title={overlap.map((o) => o.agent_key).join(", ")}>
          {t("agents.badge.overlap")}
        </Badge>
      ) : null}
    </>
  );
}

export function AgentRow({ agent, locale, overlap, ...actions }: Props) {
  const { t } = useTranslation();
  const name = agent.name[locale];
  const locked = isOrchestrator(agent);
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <HrefLink
            path={`/agents/${agent.id}`}
            className="font-semibold text-foreground hover:underline"
          >
            {name}
          </HrefLink>
          <Badges agent={agent} overlap={overlap} />
        </div>
        <div className="font-mono text-caption text-muted-foreground">{agent.key}</div>
      </TableCell>
      <TableCell>
        <Badge variant={agent.runtime === "dify-workflow" ? "off" : "info"} className="font-mono">
          {agent.runtime}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-caption">{agent.profile?.key ?? "—"}</TableCell>
      <TableCell>{agent.workflow_count}</TableCell>
      <TableCell>
        {agent.entitled_tenant_count === 0 ? (
          <Badge variant="warn">{t("agents.badge.notGranted")}</Badge>
        ) : (
          agent.entitled_tenant_count
        )}
      </TableCell>
      <TableCell>
        <span title={locked ? t("agents.orchLocked") : undefined} className="inline-flex">
          <Switch
            checked={agent.enabled}
            disabled={locked}
            aria-label={t("agents.switchLabel", { key: agent.key })}
            onCheckedChange={() => actions.onToggle(agent)}
          />
        </span>
      </TableCell>
      <TableCell className="text-right">
        <AgentRowMenu
          agent={agent}
          name={name}
          onToggle={() => actions.onToggle(agent)}
          onSetOrchestrator={() => actions.onSetOrchestrator(agent)}
          onDelete={() => actions.onDelete(agent)}
        />
      </TableCell>
    </TableRow>
  );
}
