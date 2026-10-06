// HUB-FR-60 · H4a-R08 · các agent khác (đang bật) để so mô tả trong "Xem như Orchestrator thấy" — dùng lại cache danh sách.
import type { AgentListItem } from "@ai/contracts/studio";
import { useQuery } from "@tanstack/react-query";
import { agentsQuery } from "../api";

export function useAgentPeers(selfId: string | undefined): {
  peers: AgentListItem[];
  self: AgentListItem | undefined;
} {
  const { data } = useQuery(agentsQuery());
  const items = data?.items ?? [];
  return {
    peers: items.filter((a) => a.id !== selfId && a.enabled),
    self: items.find((a) => a.id === selfId),
  };
}
