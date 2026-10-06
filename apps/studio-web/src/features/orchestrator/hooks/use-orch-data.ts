// HUB-FR-62 · dữ liệu màn Orchestrator: bản mặc định + theo tenant, agent chọn được, tenant.
import { ORCHESTRATOR_RUNTIMES } from "@ai/contracts/studio";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { agentsQuery } from "#/features/agents/api";
import { orchestratorQuery, tenantsQuery } from "../api";
import { type AgentOption, agentOptions } from "../lib/draft";

export function useOrchData() {
  const { i18n } = useTranslation();
  const locale: "vi" | "en" = i18n.language === "en" ? "en" : "vi";
  const orch = useQuery(orchestratorQuery);
  const agents = useQuery(agentsQuery({}));
  const tenants = useQuery(tenantsQuery);
  const cur = orch.data?.default.agent;
  const options = useMemo<AgentOption[]>(
    () => agentOptions(agents.data?.items ?? [], ORCHESTRATOR_RUNTIMES, locale, cur),
    [agents.data, locale, cur],
  );
  return { orch, tenants, options, locale };
}
