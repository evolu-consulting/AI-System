// ADM-FR-37 · CR-043 · tab Agent của group: mọi agent của tenant + công tắc cấp/thu hồi (lạc quan, lỗi → hoàn lại + toast).

import type { Group } from "@ai/contracts";
import type { AgentGrantListItem } from "@ai/contracts/hub-admin";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { HUB_KEYS, useGroupAgentGrants, useSetGroupAgentGrant } from "@/features/hub/api";
import { useHubTenant } from "@/features/hub/hooks/use-hub-tenant";
import { describeHubError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { pickLocalized } from "@/lib/localized";
import { useTr } from "@/lib/use-translate";

export function useGroupAgents(group: Group) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const qc = useQueryClient();
  const tenantId = useHubTenant(group.tenant_id);
  const query = useGroupAgentGrants(group.id, tenantId);
  const write = useSetGroupAgentGrant(tenantId);
  // agent_id → trạng thái lạc quan đang chờ Hub xác nhận.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());

  const patch = (agentId: string, value: boolean | undefined) =>
    setPending((prev) => {
      const next = new Map(prev);
      if (value === undefined) next.delete(agentId);
      else next.set(agentId, value);
      return next;
    });

  const isGranted = (item: AgentGrantListItem): boolean =>
    pending.get(item.agent.id) ?? item.grants.length > 0;

  const toggle = async (item: AgentGrantListItem, grant: boolean) => {
    if (pending.has(item.agent.id)) return;
    const vars = {
      agent: pickLocalized(item.agent.name, i18n.language),
      group: pickLocalized(group.name, i18n.language),
    };
    patch(item.agent.id, grant);
    try {
      await write.mutateAsync({ agentId: item.agent.id, groupId: group.id, grant });
      await qc.invalidateQueries({ queryKey: HUB_KEYS.groupGrants(group.id, tenantId) });
      notifySuccess(t(grant ? "groups.agents.granted" : "groups.agents.revoked", vars));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "UNAUTHORIZED")) {
        const spec = describeHubError(err);
        notifyError(tr(spec.key, spec.params));
      }
    } finally {
      patch(item.agent.id, undefined);
    }
  };

  return { query, isGranted, toggle, isPending: (id: string) => pending.has(id) };
}
